#[cfg(not(target_os = "windows"))]
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct SecurityLogEntry {
    pub time: Option<String>,
    pub event_id: Option<i64>,
    pub level: Option<String>,
    pub message: String,
}

#[derive(Serialize)]
pub struct SecurityLogResult {
    pub entries: Vec<SecurityLogEntry>,
    pub source: String,
}

/// Preset filters instead of a free-text query field — keeps this a fixed,
/// auditable set of "known security-relevant event IDs" rather than a
/// general-purpose log grep that could be pointed at anything.
#[cfg(target_os = "windows")]
fn event_ids_for_preset(preset: &str) -> Result<Option<Vec<i64>>, String> {
    match preset {
        // 4625 = failed logon, 4740 = account lockout
        "failed_logins" => Ok(Some(vec![4625, 4740])),
        // 4720 = user created, 4722 = user enabled, 4724 = password reset attempt,
        // 4726 = user deleted, 4728/4732 = member added to a security group,
        // 4756 = member added to a universal security group
        "account_changes" => Ok(Some(vec![4720, 4722, 4724, 4726, 4728, 4732, 4756])),
        "all_security" => Ok(None),
        other => Err(format!("Filtro de log desconocido: '{other}'.")),
    }
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinEventRaw {
    #[serde(rename = "TimeCreated")]
    time_created: Option<String>,
    #[serde(rename = "Id")]
    id: Option<i64>,
    #[serde(rename = "LevelDisplayName")]
    level: Option<String>,
    #[serde(rename = "Message")]
    message: Option<String>,
}

/// `Get-WinEvent | ConvertTo-Json` serializes a single result as a bare
/// object instead of a one-element array — this handles both shapes rather
/// than assuming PowerShell always emits an array.
#[cfg(target_os = "windows")]
fn parse_winevent_json(raw: &str) -> Vec<WinEventRaw> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if let Ok(list) = serde_json::from_str::<Vec<WinEventRaw>>(trimmed) {
        return list;
    }
    if let Ok(single) = serde_json::from_str::<WinEventRaw>(trimmed) {
        return vec![single];
    }
    vec![]
}

#[cfg(target_os = "windows")]
fn read_security_log(preset: &str, max_events: u32) -> Result<SecurityLogResult, String> {
    let id_filter = match event_ids_for_preset(preset)? {
        Some(ids) => {
            let joined = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
            format!("$filter.Id = @({joined})")
        }
        None => String::new(),
    };

    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         try {{ \
           $filter = @{{ LogName = 'Security' }}; {id_filter}; \
           $events = Get-WinEvent -FilterHashtable $filter -MaxEvents {max_events} -ErrorAction Stop | \
             Select-Object @{{n='TimeCreated';e={{$_.TimeCreated.ToString('o')}}}}, Id, LevelDisplayName, Message; \
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
        if stderr.to_lowercase().contains("denied") || stderr.to_lowercase().contains("unauthorized") {
            return Err(
                "Acceso denegado al registro de Seguridad. Ejecuta KRYPTOS como Administrador para leer estos eventos.".into(),
            );
        }
        return Err(format!("No se pudo leer el registro de Seguridad: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries = parse_winevent_json(&stdout)
        .into_iter()
        .map(|e| SecurityLogEntry {
            time: e.time_created,
            event_id: e.id,
            level: e.level,
            message: e.message.unwrap_or_default(),
        })
        .collect();

    Ok(SecurityLogResult { entries, source: "Registro de eventos de Windows (Security)".into() })
}

#[cfg(not(target_os = "windows"))]
fn read_security_log(preset: &str, max_events: u32) -> Result<SecurityLogResult, String> {
    // No universal structured "Security log" equivalent on Linux — read
    // recent journal entries and keyword-filter for auth-relevant lines.
    // Real coverage varies by distro/config; this is best-effort, not a
    // guarantee of completeness (documented in the UI, not just here).
    let keywords: &[&str] = match preset {
        "failed_logins" => &["failed password", "authentication failure", "invalid user"],
        "account_changes" => &["new user", "user added", "delete user", "usermod", "useradd", "userdel"],
        "all_security" => &[],
        other => return Err(format!("Filtro de log desconocido: '{other}'.")),
    };

    let output = Command::new("journalctl")
        .args(["-n", "500", "--no-pager", "-o", "short-iso"])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => return Err(format!("No se pudo ejecutar journalctl: {e}")),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_lowercase().contains("permission") {
            return Err("Permiso denegado al leer el journal. Prueba ejecutando KRYPTOS con sudo.".into());
        }
        return Err(format!("No se pudo leer el journal: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries: Vec<SecurityLogEntry> = stdout
        .lines()
        .filter(|line| keywords.is_empty() || keywords.iter().any(|k| line.to_lowercase().contains(k)))
        .map(|line| SecurityLogEntry { time: None, event_id: None, level: None, message: line.to_string() })
        .collect();

    entries.truncate(max_events as usize);
    Ok(SecurityLogResult { entries, source: "journalctl (mejor esfuerzo, filtrado por palabra clave)".into() })
}

/// Surfaces security-relevant OS log entries using a small set of
/// documented presets — never a free-text log query, to keep this tool
/// pointed at "known indicators", not general-purpose log spelunking.
#[tauri::command]
pub fn read_security_events(preset: String, max_events: Option<u32>) -> Result<SecurityLogResult, String> {
    read_security_log(&preset, max_events.unwrap_or(50).min(500))
}
