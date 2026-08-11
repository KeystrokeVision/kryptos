use std::io::ErrorKind;
use std::process::Command;

use serde::Serialize;

#[derive(Serialize)]
pub struct CommandOutput {
    pub success: bool,
    pub output: String,
}

fn run_nmap(args: &[String]) -> Result<CommandOutput, String> {
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match Command::new("nmap").args(&arg_refs).output() {
        Ok(out) => {
            let mut text = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.trim().is_empty() {
                text.push('\n');
                text.push_str(&stderr);
            }
            Ok(CommandOutput { success: out.status.success(), output: text })
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {
            Err("nmap no esta instalado en este sistema. Descargalo de https://nmap.org/download.html e intentalo de nuevo.".into())
        }
        Err(e) => Err(format!("No se pudo ejecutar nmap: {e}")),
    }
}

/// Runs nmap with one of three fixed, non-offensive presets against a
/// target you administer. Deliberately does NOT expose raw nmap flags or
/// NSE script selection (some scripts are vuln-exploitation-adjacent) —
/// only host discovery, a common-port scan, and service/version detection,
/// which is exactly what `run_port_check` already does but using the
/// industry-standard tool instead of a fixed 15-port list, for networks
/// you're actually responsible for.
#[tauri::command]
pub fn run_advanced_scan(target: String, scan_type: String) -> Result<CommandOutput, String> {
    let target = target.trim().to_string();
    if target.is_empty() {
        return Err("Debes indicar un host, IP o rango (ej. 192.168.1.0/24).".into());
    }

    let args: Vec<String> = match scan_type.as_str() {
        // Host discovery only — no port scan at all (-sn = "ping scan").
        "discovery" => vec!["-sn".into(), target],
        // Top 100 most common ports, fast timing.
        "ports" => vec!["-T4".into(), "--top-ports".into(), "100".into(), target],
        // Top 50 ports plus service/version detection (slower, more info).
        "version" => vec!["-T4".into(), "-sV".into(), "--top-ports".into(), "50".into(), target],
        other => return Err(format!("Tipo de escaneo desconocido: '{other}'.")),
    };

    run_nmap(&args)
}
