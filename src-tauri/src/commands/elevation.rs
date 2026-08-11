// ---------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn is_elevated_impl() -> bool {
    // `is_elevated` checks the actual process token's elevation state
    // (TokenElevation), not just "is this user an admin" — the latter
    // (IsUserAnAdmin) gives misleading answers under UAC split-tokens,
    // since a standard-user token is still held by an admin account.
    is_elevated::is_elevated()
}

#[cfg(not(target_os = "windows"))]
fn is_elevated_impl() -> bool {
    unsafe { libc::geteuid() == 0 }
}

/// Whether the current process is already running with administrator
/// (Windows) or root (Unix) privileges. The frontend uses this to show a
/// persistent status indicator and to decide when to offer "Reiniciar como
/// Administrador" instead of just surfacing a raw permission-denied error.
#[tauri::command]
pub fn is_elevated() -> bool {
    is_elevated_impl()
}

// ---------------------------------------------------------------------
// Relaunch
// ---------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn relaunch_elevated_impl() -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe = std::env::current_exe().map_err(|e| format!("No se pudo determinar la ruta del ejecutable: {e}"))?;
    let exe_wide: Vec<u16> = exe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let verb_wide: Vec<u16> = "runas\0".encode_utf16().collect();

    // ShellExecuteW with the "runas" verb triggers the UAC consent prompt
    // and launches the new (elevated) process asynchronously — it does not
    // wait for that process to exit, which is exactly what we want here:
    // start the elevated sibling, then exit this unprivileged instance.
    let result = unsafe {
        ShellExecuteW(std::ptr::null_mut(), verb_wide.as_ptr(), exe_wide.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL)
    };

    // Per the Win32 docs, a return value > 32 means success; anything else
    // is an SE_ERR_* code. 5 = ERROR_ACCESS_DENIED, which is what
    // ShellExecuteW returns when the user cancels the UAC prompt.
    let code = result as isize;
    if code > 32 {
        // Give the new elevated instance a moment to open its own SQLite
        // connection before this one exits and releases the file lock.
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(500));
            std::process::exit(0);
        });
        Ok(())
    } else if code == 5 {
        Err("Cancelaste la solicitud de permisos de administrador.".into())
    } else {
        Err(format!(
            "No se pudo reiniciar como administrador (codigo {code}). Intenta ejecutar KRYPTOS manualmente como Administrador."
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn relaunch_elevated_impl() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("No se pudo determinar la ruta del ejecutable: {e}"))?;
    // pkexec shows its own graphical auth prompt and returns once the
    // child is spawned — it doesn't block on the child's exit either.
    match std::process::Command::new("pkexec").arg(&exe).spawn() {
        Ok(_) => {
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_millis(500));
                std::process::exit(0);
            });
            Ok(())
        }
        Err(e) => Err(format!("No se pudo solicitar privilegios elevados (se necesita 'pkexec' instalado): {e}")),
    }
}

/// Relaunches KRYPTOS elevated and exits the current instance shortly
/// after a successful relaunch. If the user cancels the prompt, this
/// returns an error and the current (unprivileged) instance keeps running
/// exactly as it was — nothing is torn down until the new instance is
/// actually starting up.
#[tauri::command]
pub fn relaunch_elevated() -> Result<(), String> {
    relaunch_elevated_impl()
}
