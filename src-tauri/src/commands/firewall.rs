use std::process::Command;

use serde::Serialize;

#[derive(Serialize)]
pub struct CommandOutput {
    pub success: bool,
    pub output: String,
}

#[derive(Serialize)]
pub struct FirewallRule {
    pub id: String,
    pub name: String,
    pub enabled: Option<bool>,
    pub direction: Option<String>,
    pub action: Option<String>,
    pub protocol: Option<String>,
    pub local_port: Option<String>,
}

fn validate_direction(direction: &str) -> Result<&'static str, String> {
    match direction.to_lowercase().as_str() {
        "in" | "inbound" => Ok("in"),
        "out" | "outbound" => Ok("out"),
        other => Err(format!("Direccion invalida: '{other}'. Usa 'in' o 'out'.")),
    }
}

fn validate_action(action: &str) -> Result<&'static str, String> {
    match action.to_lowercase().as_str() {
        "allow" => Ok("allow"),
        "block" | "deny" => Ok("block"),
        other => Err(format!("Accion invalida: '{other}'. Usa 'allow' o 'block'.")),
    }
}

fn validate_protocol(protocol: &str) -> Result<&'static str, String> {
    match protocol.to_uppercase().as_str() {
        "TCP" => Ok("TCP"),
        "UDP" => Ok("UDP"),
        "ANY" => Ok("Any"),
        other => Err(format!("Protocolo invalido: '{other}'. Usa 'TCP', 'UDP' o 'Any'.")),
    }
}

fn validate_port(port: &str) -> Result<String, String> {
    let port = port.trim();
    if port.eq_ignore_ascii_case("any") {
        return Ok("any".to_string());
    }
    match port.parse::<u16>() {
        Ok(p) if p > 0 => Ok(p.to_string()),
        _ => Err(format!("Puerto invalido: '{port}'.")),
    }
}

// ---------------------------------------------------------------------
// Windows — netsh advfirewall
// ---------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn parse_netsh_rules(output: &str) -> Vec<FirewallRule> {
    let mut rules = Vec::new();
    let mut current: Option<FirewallRule> = None;

    for line in output.lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            continue;
        }
        let Some(colon_idx) = line.find(':') else { continue };
        let key = line[..colon_idx].trim();
        let value = line[colon_idx + 1..].trim();

        if key.eq_ignore_ascii_case("Rule Name") {
            if let Some(r) = current.take() {
                rules.push(r);
            }
            current = Some(FirewallRule {
                id: value.to_string(),
                name: value.to_string(),
                enabled: None,
                direction: None,
                action: None,
                protocol: None,
                local_port: None,
            });
            continue;
        }

        if let Some(r) = current.as_mut() {
            match key {
                k if k.eq_ignore_ascii_case("Enabled") => r.enabled = Some(value.eq_ignore_ascii_case("Yes")),
                k if k.eq_ignore_ascii_case("Direction") => r.direction = Some(value.to_string()),
                k if k.eq_ignore_ascii_case("Action") => r.action = Some(value.to_string()),
                k if k.eq_ignore_ascii_case("Protocol") => r.protocol = Some(value.to_string()),
                k if k.eq_ignore_ascii_case("LocalPort") => r.local_port = Some(value.to_string()),
                _ => {}
            }
        }
    }
    if let Some(r) = current.take() {
        rules.push(r);
    }
    rules
}

#[cfg(target_os = "windows")]
fn list_rules_impl() -> Result<Vec<FirewallRule>, String> {
    let out = Command::new("netsh")
        .args(["advfirewall", "firewall", "show", "rule", "name=all"])
        .output()
        .map_err(|e| format!("No se pudo ejecutar netsh: {e}"))?;
    if !out.status.success() {
        return Err(permission_hint(&String::from_utf8_lossy(&out.stderr)));
    }
    Ok(parse_netsh_rules(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(target_os = "windows")]
fn add_rule_impl(name: &str, direction: &str, action: &str, protocol: &str, port: &str) -> Result<CommandOutput, String> {
    let out = Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            &format!("name={name}"),
            &format!("dir={direction}"),
            &format!("action={action}"),
            &format!("protocol={protocol}"),
            &format!("localport={port}"),
        ])
        .output()
        .map_err(|e| format!("No se pudo ejecutar netsh: {e}"))?;
    to_command_output(out)
}

#[cfg(target_os = "windows")]
fn delete_rule_impl(name: &str) -> Result<CommandOutput, String> {
    let out = Command::new("netsh")
        .args(["advfirewall", "firewall", "delete", "rule", &format!("name={name}")])
        .output()
        .map_err(|e| format!("No se pudo ejecutar netsh: {e}"))?;
    to_command_output(out)
}

// ---------------------------------------------------------------------
// Linux — ufw
// ---------------------------------------------------------------------

#[cfg(not(target_os = "windows"))]
fn parse_ufw_rules(output: &str) -> Vec<FirewallRule> {
    let mut rules = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if !line.starts_with('[') {
            continue;
        }
        let Some(close) = line.find(']') else { continue };
        let id = line[1..close].trim().to_string();
        let rest = line[close + 1..].trim();
        let action = if rest.contains("ALLOW") {
            "Allow"
        } else if rest.contains("DENY") {
            "Block"
        } else if rest.contains("REJECT") {
            "Block"
        } else {
            "?"
        };
        let to = rest.split_whitespace().next().unwrap_or("").to_string();
        let (protocol, local_port) = match to.split_once('/') {
            Some((port, proto)) => (Some(proto.to_uppercase()), Some(port.to_string())),
            None => (None, Some(to.clone())),
        };
        rules.push(FirewallRule {
            id,
            name: to,
            enabled: Some(true),
            direction: Some("in".into()),
            action: Some(action.into()),
            protocol,
            local_port,
        });
    }
    rules
}

#[cfg(not(target_os = "windows"))]
fn list_rules_impl() -> Result<Vec<FirewallRule>, String> {
    let out = Command::new("ufw")
        .args(["status", "numbered"])
        .output()
        .map_err(|_| "ufw no esta instalado o no esta disponible en este sistema.".to_string())?;
    if !out.status.success() {
        return Err(permission_hint(&String::from_utf8_lossy(&out.stderr)));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    if stdout.contains("inactive") {
        return Err("ufw esta instalado pero inactivo. Actívalo con 'sudo ufw enable' y vuelve a intentarlo.".into());
    }
    Ok(parse_ufw_rules(&stdout))
}

#[cfg(not(target_os = "windows"))]
fn add_rule_impl(_name: &str, direction: &str, action: &str, protocol: &str, port: &str) -> Result<CommandOutput, String> {
    let verb = if action == "allow" { "allow" } else { "deny" };
    let rule_spec = if protocol.eq_ignore_ascii_case("any") || port.eq_ignore_ascii_case("any") {
        port.to_string()
    } else {
        format!("{port}/{}", protocol.to_lowercase())
    };
    let mut args = vec![verb.to_string()];
    if direction == "out" {
        args.push("out".to_string());
    }
    args.push(rule_spec);
    let out = Command::new("ufw")
        .args(args.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .output()
        .map_err(|_| "ufw no esta instalado o no esta disponible en este sistema.".to_string())?;
    to_command_output(out)
}

#[cfg(not(target_os = "windows"))]
fn delete_rule_impl(id: &str) -> Result<CommandOutput, String> {
    let out = Command::new("ufw")
        .args(["--force", "delete", id])
        .output()
        .map_err(|_| "ufw no esta instalado o no esta disponible en este sistema.".to_string())?;
    to_command_output(out)
}

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

fn to_command_output(out: std::process::Output) -> Result<CommandOutput, String> {
    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !stderr.trim().is_empty() {
        text.push('\n');
        text.push_str(&stderr);
    }
    if !out.status.success() {
        return Err(permission_hint(&text));
    }
    Ok(CommandOutput { success: out.status.success(), output: text })
}

fn permission_hint(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("denied") || lower.contains("access is denied") || lower.contains("permission") || lower.contains("requires elevation") {
        #[cfg(target_os = "windows")]
        {
            "Acceso denegado. Ejecuta KRYPTOS como Administrador para administrar el firewall.".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "Permiso denegado. Ejecuta KRYPTOS con sudo para administrar el firewall.".to_string()
        }
    } else if stderr.trim().is_empty() {
        "El comando de firewall fallo sin mas detalles.".to_string()
    } else {
        stderr.trim().to_string()
    }
}

/// Lists current firewall rules (Windows Defender Firewall via `netsh`, or
/// `ufw` on Linux). Read-only, no confirmation needed.
#[tauri::command]
pub fn list_firewall_rules() -> Result<Vec<FirewallRule>, String> {
    list_rules_impl()
}

/// Adds a port-based allow/block rule. Scoped to port + protocol + direction
/// only (no arbitrary program paths or IP ranges) to keep this predictable.
/// The frontend must confirm with the user before calling this — same
/// convention as `kill_process` and `delete_baseline`.
#[tauri::command]
pub fn add_firewall_rule(
    name: String,
    direction: String,
    action: String,
    protocol: String,
    port: String,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<CommandOutput, String> {
    if name.trim().is_empty() {
        return Err("Ponle un nombre a la regla.".into());
    }
    let direction = validate_direction(&direction)?;
    let action = validate_action(&action)?;
    let protocol = validate_protocol(&protocol)?;
    let port = validate_port(&port)?;
    let target = format!("{} ({direction}, {action}, {protocol}/{port})", name.trim());
    match add_rule_impl(name.trim(), direction, action, protocol, &port) {
        Ok(out) => {
            crate::commands::audit::record_audit_event(&db, "add_firewall_rule", &target, "ok", None);
            Ok(out)
        }
        Err(e) => {
            crate::commands::audit::record_audit_event(&db, "add_firewall_rule", &target, "error", Some(&e));
            Err(e)
        }
    }
}

/// Deletes a rule by id (its exact name on Windows, its numbered id on
/// Linux/ufw). Confirmed by the frontend before calling.
#[tauri::command]
pub fn delete_firewall_rule(id: String, db: tauri::State<'_, crate::db::Db>) -> Result<CommandOutput, String> {
    if id.trim().is_empty() {
        return Err("Falta el identificador de la regla a eliminar.".into());
    }
    match delete_rule_impl(id.trim()) {
        Ok(out) => {
            crate::commands::audit::record_audit_event(&db, "delete_firewall_rule", id.trim(), "ok", None);
            Ok(out)
        }
        Err(e) => {
            crate::commands::audit::record_audit_event(&db, "delete_firewall_rule", id.trim(), "error", Some(&e));
            Err(e)
        }
    }
}
