#[cfg(not(target_os = "windows"))]
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct LogEntry {
    pub time: Option<String>,
    pub level: Option<String>,
    pub source: Option<String>,
    pub message: String,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinLogRaw {
    #[serde(rename = "TimeCreated")]
    time_created: Option<String>,
    #[serde(rename = "LevelDisplayName")]
    level: Option<String>,
    #[serde(rename = "ProviderName")]
    provider_name: Option<String>,
    #[serde(rename = "Message")]
    message: Option<String>,
}

#[cfg(target_os = "windows")]
fn parse_log_json(raw: &str) -> Vec<WinLogRaw> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if let Ok(list) = serde_json::from_str::<Vec<WinLogRaw>>(trimmed) {
        return list;
    }
    if let Ok(single) = serde_json::from_str::<WinLogRaw>(trimmed) {
        return vec![single];
    }
    vec![]
}

#[cfg(target_os = "windows")]
fn read_logs_impl(log_name: &str, level_filter: Option<&str>, max_entries: u32) -> Result<Vec<LogEntry>, String> {
    if !["Application", "System"].contains(&log_name) {
        return Err(format!("Registro desconocido: '{log_name}'."));
    }
    let level_line = match level_filter {
        Some("Error") => "$filter.Level = @(1,2)",
        Some("Warning") => "$filter.Level = 3",
        Some("Information") => "$filter.Level = 4",
        _ => "",
    };

    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         try {{ \
           $filter = @{{ LogName = '{log_name}' }}; {level_line}; \
           $events = Get-WinEvent -FilterHashtable $filter -MaxEvents {max_entries} -ErrorAction Stop | \
             Select-Object @{{n='TimeCreated';e={{$_.TimeCreated.ToString('o')}}}}, LevelDisplayName, ProviderName, Message; \
           $events = @($events); \
           $events | ConvertTo-Json -Compress -Depth 3 \
         }} catch {{ \
           if ($_.Exception.Message -like '*No events*') {{ Write-Output '[]' }} \
           else {{ Write-Error $_.Exception.Message; exit 1 }} \
         }}"
    );

    let output = crate::commands::run_powershell_utf8(&script).map_err(|e| format!("No se pudo ejecutar PowerShell: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_lowercase().contains("denied") {
            return Err("Acceso denegado al registro de eventos. Ejecuta KRYPTOS como Administrador.".into());
        }
        return Err(if stderr.trim().is_empty() { "No se pudo leer el registro de eventos.".into() } else { stderr.to_string() });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_log_json(&stdout)
        .into_iter()
        .map(|e| LogEntry {
            time: e.time_created,
            level: e.level,
            source: e.provider_name,
            message: e.message.unwrap_or_default(),
        })
        .collect())
}

#[cfg(not(target_os = "windows"))]
fn read_logs_impl(_log_name: &str, level_filter: Option<&str>, max_entries: u32) -> Result<Vec<LogEntry>, String> {
    let mut args = vec!["-n".to_string(), max_entries.to_string(), "--no-pager".to_string(), "-o".to_string(), "short-iso".to_string()];
    if let Some(level) = level_filter {
        let priority = match level {
            "Error" => "err",
            "Warning" => "warning",
            "Information" => "info",
            other => return Err(format!("Nivel desconocido: '{other}'.")),
        };
        args.push("-p".to_string());
        args.push(priority.to_string());
    }

    let output = Command::new("journalctl").args(&args).output().map_err(|e| format!("No se pudo ejecutar journalctl: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() { "No se pudo leer el journal.".into() } else { stderr.to_string() });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout
        .lines()
        .map(|line| LogEntry { time: None, level: level_filter.map(|s| s.to_string()), source: None, message: line.to_string() })
        .collect())
}

/// Reads general system logs — Application/System event logs on Windows,
/// or the general journal on Linux. Distinct from the Security module's
/// `read_security_events`, which is scoped to auth/account-change presets
/// only; this one is broader and meant for general troubleshooting.
#[tauri::command]
pub fn read_system_logs(log_name: String, level_filter: Option<String>, max_entries: Option<u32>) -> Result<Vec<LogEntry>, String> {
    read_logs_impl(&log_name, level_filter.as_deref(), max_entries.unwrap_or(100).min(1000))
}
