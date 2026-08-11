#[cfg(not(target_os = "windows"))]
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::audit::record_audit_event;
use crate::db::Db;

#[derive(Serialize)]
pub struct ServiceInfo {
    pub name: String,
    pub display_name: String,
    pub status: String,
    pub start_type: Option<String>,
}

fn escape_powershell_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

// ---------------------------------------------------------------------
// Windows — Service Control Manager via PowerShell
// ---------------------------------------------------------------------

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinServiceRaw {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "DisplayName")]
    display_name: Option<String>,
    #[serde(rename = "Status")]
    status: Option<String>,
    #[serde(rename = "StartType")]
    start_type: Option<String>,
}

#[cfg(target_os = "windows")]
fn parse_services_json(raw: &str) -> Vec<WinServiceRaw> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if let Ok(list) = serde_json::from_str::<Vec<WinServiceRaw>>(trimmed) {
        return list;
    }
    if let Ok(single) = serde_json::from_str::<WinServiceRaw>(trimmed) {
        return vec![single];
    }
    vec![]
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str) -> Result<String, String> {
    let output = crate::commands::run_powershell_utf8(script).map_err(|e| format!("No se pudo ejecutar PowerShell: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.to_lowercase().contains("denied") || stderr.to_lowercase().contains("access") {
            return Err("Acceso denegado. Ejecuta KRYPTOS como Administrador para administrar servicios.".into());
        }
        return Err(if stderr.trim().is_empty() { "El comando fallo sin mas detalles.".into() } else { stderr });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(target_os = "windows")]
fn list_services_impl() -> Result<Vec<ServiceInfo>, String> {
    let stdout = run_powershell(
        "Get-Service | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Json -Compress",
    )?;
    Ok(parse_services_json(&stdout)
        .into_iter()
        .map(|s| ServiceInfo {
            display_name: s.display_name.unwrap_or_else(|| s.name.clone()),
            name: s.name,
            status: s.status.unwrap_or_else(|| "Desconocido".into()),
            start_type: s.start_type,
        })
        .collect())
}

#[cfg(target_os = "windows")]
fn control_service_impl(name: &str, verb: &str) -> Result<(), String> {
    let safe_name = escape_powershell_single_quoted(name);
    let cmdlet = match verb {
        "start" => "Start-Service",
        "stop" => "Stop-Service -Force",
        "restart" => "Restart-Service -Force",
        other => return Err(format!("Accion desconocida: '{other}'.")),
    };
    run_powershell(&format!("{cmdlet} -Name '{safe_name}' -ErrorAction Stop")).map(|_| ())
}

// ---------------------------------------------------------------------
// Linux — systemctl
// ---------------------------------------------------------------------

#[cfg(not(target_os = "windows"))]
fn list_services_impl() -> Result<Vec<ServiceInfo>, String> {
    let output = Command::new("systemctl")
        .args(["list-units", "--type=service", "--all", "--no-pager", "--plain", "--no-legend"])
        .output()
        .map_err(|e| format!("No se pudo ejecutar systemctl: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(if stderr.trim().is_empty() {
            "No se pudo listar los servicios (systemctl fallo).".into()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut services = Vec::new();
    for line in stdout.lines() {
        let mut parts = line.split_whitespace();
        let Some(unit) = parts.next() else { continue };
        let _load = parts.next();
        let active = parts.next().unwrap_or("?");
        let sub = parts.next().unwrap_or("?");
        let description: String = parts.collect::<Vec<_>>().join(" ");
        services.push(ServiceInfo {
            name: unit.trim_end_matches(".service").to_string(),
            display_name: if description.is_empty() { unit.to_string() } else { description },
            status: format!("{active} ({sub})"),
            start_type: None,
        });
    }
    Ok(services)
}

#[cfg(not(target_os = "windows"))]
fn control_service_impl(name: &str, verb: &str) -> Result<(), String> {
    if !["start", "stop", "restart"].contains(&verb) {
        return Err(format!("Accion desconocida: '{verb}'."));
    }
    let unit = if name.ends_with(".service") { name.to_string() } else { format!("{name}.service") };
    let output = Command::new("systemctl")
        .args([verb, &unit])
        .output()
        .map_err(|e| format!("No se pudo ejecutar systemctl: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if stderr.to_lowercase().contains("permission") || stderr.to_lowercase().contains("not authorized") || stderr.to_lowercase().contains("interactive authentication") {
            return Err("Permiso denegado. Ejecuta KRYPTOS con sudo/pkexec para administrar servicios.".into());
        }
        return Err(if stderr.trim().is_empty() { format!("No se pudo {verb} el servicio.") } else { stderr });
    }
    Ok(())
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

/// Lists system services with their current status. Read-only, no
/// confirmation needed — but on Windows this can still fail with a
/// permission error for certain protected services depending on account
/// rights.
#[tauri::command]
pub fn list_services() -> Result<Vec<ServiceInfo>, String> {
    list_services_impl()
}

fn control_service(name: String, verb: &'static str, db: State<'_, Db>) -> Result<(), String> {
    match control_service_impl(&name, verb) {
        Ok(()) => {
            record_audit_event(&db, &format!("{verb}_service"), &name, "ok", None);
            Ok(())
        }
        Err(e) => {
            record_audit_event(&db, &format!("{verb}_service"), &name, "error", Some(&e));
            Err(e)
        }
    }
}

/// Starts a service. The frontend confirms with the user before calling
/// this for consistency with stop/restart, even though starting is
/// non-destructive.
#[tauri::command]
pub fn start_service(name: String, db: State<'_, Db>) -> Result<(), String> {
    control_service(name, "start", db)
}

/// Stops a service — confirmed by the frontend first, since this can break
/// whatever depends on it.
#[tauri::command]
pub fn stop_service(name: String, db: State<'_, Db>) -> Result<(), String> {
    control_service(name, "stop", db)
}

/// Restarts a service — confirmed by the frontend first.
#[tauri::command]
pub fn restart_service(name: String, db: State<'_, Db>) -> Result<(), String> {
    control_service(name, "restart", db)
}
