use std::process::Command;

use tauri::State;

use crate::commands::audit::record_audit_event;
use crate::db::Db;

#[cfg(target_os = "windows")]
fn lock_session_impl() -> Result<(), String> {
    Command::new("rundll32.exe")
        .args(["user32.dll,LockWorkStation"])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("No se pudo bloquear la sesion: {e}"))
}

#[cfg(not(target_os = "windows"))]
fn lock_session_impl() -> Result<(), String> {
    let attempts: &[(&str, &[&str])] =
        &[("loginctl", &["lock-session"]), ("xdg-screensaver", &["lock"]), ("gnome-screensaver-command", &["--lock"])];
    for (cmd, args) in attempts {
        if Command::new(cmd).args(*args).spawn().is_ok() {
            return Ok(());
        }
    }
    Err("No se encontro una forma de bloquear la sesion en este entorno de escritorio.".into())
}

/// Locks the local session immediately — the same as pressing Win+L.
/// Safe, standard, reversible with your password.
#[tauri::command]
pub fn panic_lock_session(db: State<'_, Db>) -> Result<(), String> {
    let result = lock_session_impl();
    record_audit_event(&db, "panic_lock_session", "equipo local", if result.is_ok() { "ok" } else { "error" }, result.as_ref().err().map(|s| s.as_str()));
    result
}

#[cfg(target_os = "windows")]
fn set_network_impl(enable: bool) -> Result<(), String> {
    let cmdlet = if enable { "Enable-NetAdapter" } else { "Disable-NetAdapter" };
    let script = format!("{cmdlet} -Name * -Confirm:$false -ErrorAction Stop");
    let output = crate::commands::run_powershell_utf8(&script).map_err(|e| format!("No se pudo ejecutar PowerShell: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let lower = stderr.to_lowercase();
        return Err(if lower.contains("denied") || lower.contains("access") {
            "Acceso denegado. Ejecuta KRYPTOS como Administrador para aislar la red.".to_string()
        } else if stderr.trim().is_empty() {
            "No se pudo cambiar el estado de la red.".to_string()
        } else {
            stderr.to_string()
        });
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_network_impl(enable: bool) -> Result<(), String> {
    let arg = if enable { "on" } else { "off" };
    match Command::new("nmcli").args(["networking", arg]).output() {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!("nmcli fallo: {}", String::from_utf8_lossy(&out.stderr))),
        Err(_) => Err("No se encontro 'nmcli' (NetworkManager). No se pudo cambiar el estado de la red.".into()),
    }
}

/// Disables (or, with `enable: true`, re-enables) every network adapter on
/// this machine — the standard first move in incident response: cut the
/// machine off the network before doing anything else. Only ever acts on
/// this local machine's own adapters — this command itself has no notion of
/// "remote". It can also be reached indirectly via Modo Flota
/// (fleet_request_action in commands/chat.rs), but that path always shows
/// an explicit confirmation on THIS machine before ever calling here; no
/// caller, local or remote, skips that gate. Requires administrator/root
/// privileges.
#[tauri::command]
pub fn panic_set_network(enable: bool, db: State<'_, Db>) -> Result<(), String> {
    let result = set_network_impl(enable);
    let action = if enable { "panic_network_restore" } else { "panic_network_isolate" };
    record_audit_event(&db, action, "equipo local", if result.is_ok() { "ok" } else { "error" }, result.as_ref().err().map(|s| s.as_str()));
    result
}
