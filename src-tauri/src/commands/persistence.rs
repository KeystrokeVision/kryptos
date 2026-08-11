#[cfg(not(target_os = "windows"))]
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct ScheduledTaskInfo {
    pub name: String,
    pub source: String,
    pub schedule: Option<String>,
    pub command: String,
    pub enabled: Option<bool>,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinTaskRaw {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Path")]
    path: Option<String>,
    #[serde(rename = "State")]
    state: Option<String>,
    #[serde(rename = "Action")]
    action: Option<String>,
}

#[cfg(target_os = "windows")]
fn parse_tasks_json(raw: &str) -> Vec<WinTaskRaw> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if let Ok(list) = serde_json::from_str::<Vec<WinTaskRaw>>(trimmed) {
        return list;
    }
    if let Ok(single) = serde_json::from_str::<WinTaskRaw>(trimmed) {
        return vec![single];
    }
    vec![]
}

#[cfg(target_os = "windows")]
fn list_scheduled_tasks_impl() -> Result<Vec<ScheduledTaskInfo>, String> {
    let script = "Get-ScheduledTask | ForEach-Object { \
        $actionText = ($_.Actions | ForEach-Object { (\"$($_.Execute) $($_.Arguments)\").Trim() }) -join '; '; \
        [PSCustomObject]@{ Name = $_.TaskName; Path = $_.TaskPath; State = $_.State.ToString(); Action = $actionText } \
      } | ConvertTo-Json -Compress";

    let output = crate::commands::run_powershell_utf8(script).map_err(|e| format!("No se pudo ejecutar PowerShell: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() { "No se pudieron listar las tareas programadas.".into() } else { stderr.to_string() });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_tasks_json(&stdout)
        .into_iter()
        .map(|t| ScheduledTaskInfo {
            name: t.name,
            source: format!("Programador de tareas ({})", t.path.unwrap_or_default()),
            schedule: None,
            command: t.action.unwrap_or_default(),
            enabled: t.state.map(|s| s == "Ready" || s == "Running"),
        })
        .collect())
}

// ---------------------------------------------------------------------
// Linux — cron
// ---------------------------------------------------------------------

#[cfg(not(target_os = "windows"))]
fn parse_system_crontab_line(line: &str, source: &str) -> Option<ScheduledTaskInfo> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    if trimmed.chars().next()?.is_alphabetic() {
        return None;
    }
    let fields: Vec<&str> = trimmed.split_whitespace().collect();
    if fields.len() < 7 {
        return None;
    }
    let schedule = fields[0..5].join(" ");
    let user = fields[5];
    let command = fields[6..].join(" ");
    Some(ScheduledTaskInfo {
        name: format!("{user}: {}", command.chars().take(60).collect::<String>()),
        source: source.to_string(),
        schedule: Some(schedule),
        command,
        enabled: Some(true),
    })
}

#[cfg(not(target_os = "windows"))]
fn parse_user_crontab_line(line: &str) -> Option<ScheduledTaskInfo> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    if trimmed.chars().next()?.is_alphabetic() {
        return None;
    }
    let fields: Vec<&str> = trimmed.split_whitespace().collect();
    if fields.len() < 6 {
        return None;
    }
    let schedule = fields[0..5].join(" ");
    let command = fields[5..].join(" ");
    Some(ScheduledTaskInfo {
        name: format!("(usuario actual): {}", command.chars().take(60).collect::<String>()),
        source: "crontab del usuario actual".to_string(),
        schedule: Some(schedule),
        command,
        enabled: Some(true),
    })
}

#[cfg(not(target_os = "windows"))]
fn list_scheduled_tasks_impl() -> Result<Vec<ScheduledTaskInfo>, String> {
    let mut tasks = Vec::new();

    if let Ok(content) = std::fs::read_to_string("/etc/crontab") {
        tasks.extend(content.lines().filter_map(|l| parse_system_crontab_line(l, "/etc/crontab")));
    }
    if let Ok(read_dir) = std::fs::read_dir("/etc/cron.d") {
        for entry in read_dir.filter_map(|e| e.ok()) {
            let path = entry.path();
            if let Ok(content) = std::fs::read_to_string(&path) {
                let source = path.display().to_string();
                tasks.extend(content.lines().filter_map(|l| parse_system_crontab_line(l, &source)));
            }
        }
    }

    if let Ok(output) = Command::new("crontab").arg("-l").output() {
        if output.status.success() {
            let content = String::from_utf8_lossy(&output.stdout);
            tasks.extend(content.lines().filter_map(parse_user_crontab_line));
        }
    }

    Ok(tasks)
}

/// Lists everything configured to run automatically — Windows Scheduled
/// Tasks, or cron jobs (system crontab, /etc/cron.d/*, and the current
/// user's own crontab) on Linux. Same category of check Sysinternals'
/// Autoruns does: persistence mechanisms are how malware survives a
/// reboot, so an unexpected entry here is a real signal — this tool only
/// reads and reports, it doesn't judge or remove anything automatically.
#[tauri::command]
pub fn list_scheduled_tasks() -> Result<Vec<ScheduledTaskInfo>, String> {
    list_scheduled_tasks_impl()
}
