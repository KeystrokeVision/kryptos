use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct UserAccount {
    pub username: String,
    pub description: Option<String>,
    pub enabled: Option<bool>,
    pub is_system: bool,
    pub home_dir: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinUserRaw {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Enabled")]
    enabled: Option<bool>,
    #[serde(rename = "Description")]
    description: Option<String>,
}

#[cfg(target_os = "windows")]
fn parse_users_json(raw: &str) -> Vec<WinUserRaw> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if let Ok(list) = serde_json::from_str::<Vec<WinUserRaw>>(trimmed) {
        return list;
    }
    if let Ok(single) = serde_json::from_str::<WinUserRaw>(trimmed) {
        return vec![single];
    }
    vec![]
}

/// Well-known built-in Windows accounts that aren't meant to be logged
/// into interactively — flagged as "system" the same way Linux's UID<1000
/// convention flags service accounts.
#[cfg(target_os = "windows")]
const WIN_SYSTEM_ACCOUNTS: &[&str] = &["Administrator", "Guest", "DefaultAccount", "WDAGUtilityAccount"];

#[cfg(target_os = "windows")]
fn list_users_impl() -> Result<Vec<UserAccount>, String> {
    let output = crate::commands::run_powershell_utf8("Get-LocalUser | Select-Object Name, Enabled, Description | ConvertTo-Json -Compress")
        .map_err(|e| format!("No se pudo ejecutar PowerShell: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_lowercase().contains("denied") || stderr.to_lowercase().contains("access") {
            return Err("Acceso denegado. Ejecuta KRYPTOS como Administrador para listar las cuentas locales.".into());
        }
        return Err(if stderr.trim().is_empty() { "No se pudieron listar las cuentas de usuario.".into() } else { stderr.to_string() });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_users_json(&stdout)
        .into_iter()
        .map(|u| UserAccount {
            is_system: WIN_SYSTEM_ACCOUNTS.contains(&u.name.as_str()),
            username: u.name,
            description: u.description.filter(|d| !d.is_empty()),
            enabled: u.enabled,
            home_dir: None,
        })
        .collect())
}

#[cfg(not(target_os = "windows"))]
fn list_users_impl() -> Result<Vec<UserAccount>, String> {
    let content = std::fs::read_to_string("/etc/passwd").map_err(|e| format!("No se pudo leer /etc/passwd: {e}"))?;

    let users = content
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(':').collect();
            if fields.len() < 7 {
                return None;
            }
            let uid: u32 = fields[2].parse().unwrap_or(0);
            let comment = fields[4].split(',').next().unwrap_or("").trim();
            Some(UserAccount {
                username: fields[0].to_string(),
                description: if comment.is_empty() { None } else { Some(comment.to_string()) },
                // /etc/passwd doesn't carry an explicit enabled/locked flag —
                // that lives in /etc/shadow, which requires root to even
                // read. A login shell of nologin/false is the closest
                // read-without-privileges proxy for "can't log in".
                enabled: Some(!fields[6].ends_with("nologin") && !fields[6].ends_with("/false")),
                is_system: uid < 1000,
                home_dir: Some(fields[5].to_string()),
            })
        })
        .collect();
    Ok(users)
}

/// Lists OS-level user accounts. Read-only by design — the roadmap
/// explicitly scopes this module to viewing, not modifying, account state
/// until a real permissions model is designed for that.
#[tauri::command]
pub fn list_users() -> Result<Vec<UserAccount>, String> {
    list_users_impl()
}
