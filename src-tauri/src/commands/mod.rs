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
pub mod honeytoken;
pub mod logs;
pub mod network_details;
pub mod network_scan;
pub mod network_tools;
pub mod panic;
pub mod password_tools;
pub mod persistence;
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
