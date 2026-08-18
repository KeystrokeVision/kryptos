/// Runs a PowerShell script and returns its raw `Output`, forcing UTF-8 on
/// the way out. Windows PowerShell (5.1) writes redirected/piped stdout
/// using the console's legacy OEM/ANSI codepage by default — on a
/// Spanish-locale Windows that's usually CP850/1252, not UTF-8 — so any
/// accented character (á, é, í, ó, ú, ñ) a script prints comes back as
/// invalid UTF-8 and gets mangled into "?" once Rust decodes it. Forcing
/// `[Console]::OutputEncoding` at the top of the script is the standard fix;
/// every `#[tauri::command]` that shells out to PowerShell should go through
/// here instead of calling `Command::new("powershell")` directly.
#[cfg(target_os = "windows")]
pub fn run_powershell_utf8(script: &str) -> std::io::Result<std::process::Output> {
    let wrapped = format!("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; {script}");
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &wrapped])
        .output()
}

/// Root folder for anything meant to travel with KRYPTOS itself rather than
/// stay tied to this one Windows profile — the app launcher's entries
/// (shortcuts, imported portable programs) and the scripts library. Lives
/// right next to the running executable (`<kryptos>/kryptos_data/`), so
/// zipping up the KRYPTOS folder and handing it to someone else brings
/// along the same apps/scripts you set up, the same way a portable
/// program carries its own settings folder alongside it — unlike the
/// per-machine audit log and security baselines, which stay in the
/// Windows profile on purpose (see `db.rs`, `commands::baseline`).
///
/// Requires KRYPTOS to run from a folder the current user can write to
/// (Desktop, Documents, a USB stick, `C:\KRYPTOS`, ...) rather than
/// straight out of `Program Files` without elevation.
pub fn portable_data_root() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("No se pudo determinar la ubicacion de KRYPTOS: {e}"))?;
    let base = exe.parent().ok_or_else(|| "No se pudo determinar la carpeta de KRYPTOS.".to_string())?;
    let dir = base.join("kryptos_data");
    std::fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "No se pudo crear la carpeta de datos de KRYPTOS junto al programa ('{}'): {e}. Si KRYPTOS esta en una carpeta protegida (como Archivos de Programa), muevelo a una carpeta con permiso de escritura, como el Escritorio o Documentos.",
            dir.display()
        )
    })?;
    Ok(dir)
}

pub mod apps;
pub mod binary_analysis;
pub mod disk_usage;
pub mod audit;
pub mod baseline;
pub mod chat;
pub mod database;
pub mod docker;
pub mod dossier;
pub mod elevation;
pub mod explorer;
pub mod file_crypto;
pub mod file_watch;
pub mod firewall;
pub mod git;
pub mod hacktools;
pub mod honeytoken;
pub mod logs;
pub mod network_details;
pub mod network_scan;
pub mod network_tools;
pub mod panic;
pub mod password_tools;
pub mod persistence;
pub mod plugins;
pub mod recon;
pub mod scripts;
pub mod security;
pub mod security_logs;
pub mod sentinel;
pub mod services;
pub mod settings;
pub mod sftp;
pub mod ssh;
pub mod system;
pub mod terminal;
pub mod users;
pub mod window;
pub mod winget;
pub mod wireless;
