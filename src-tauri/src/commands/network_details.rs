use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct ConnectionInfo {
    pub protocol: String,
    pub local_addr: String,
    pub remote_addr: String,
    pub state: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Serialize)]
pub struct NetworkConfig {
    pub gateway: Option<String>,
    pub dns_servers: Vec<String>,
}

// ---------------------------------------------------------------------
// Active connections
// ---------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn list_connections_impl() -> Result<Vec<ConnectionInfo>, String> {
    let output = Command::new("netstat")
        .args(["-ano"])
        .output()
        .map_err(|e| format!("No se pudo ejecutar netstat: {e}"))?;
    if !output.status.success() {
        return Err("netstat fallo al listar las conexiones.".into());
    }
    Ok(parse_netstat_ano(&String::from_utf8_lossy(&output.stdout)))
}

fn parse_netstat_ano(output: &str) -> Vec<ConnectionInfo> {
    let mut conns = Vec::new();
    for line in output.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let Some(&proto) = tokens.first() else { continue };
        match proto {
            "TCP" if tokens.len() >= 5 => conns.push(ConnectionInfo {
                protocol: proto.to_string(),
                local_addr: tokens[1].to_string(),
                remote_addr: tokens[2].to_string(),
                state: Some(tokens[3].to_string()),
                pid: tokens[4].parse().ok(),
            }),
            "UDP" if tokens.len() >= 4 => conns.push(ConnectionInfo {
                protocol: proto.to_string(),
                local_addr: tokens[1].to_string(),
                remote_addr: tokens[2].to_string(),
                state: None,
                pid: tokens[3].parse().ok(),
            }),
            _ => {}
        }
    }
    conns
}

#[cfg(not(target_os = "windows"))]
fn list_connections_impl() -> Result<Vec<ConnectionInfo>, String> {
    // `ss` (iproute2) is the modern replacement for netstat and ships by
    // default on essentially every current Linux distro.
    let output = Command::new("ss")
        .args(["-tunap"])
        .output()
        .map_err(|_| "No se pudo ejecutar 'ss' (parte de iproute2).".to_string())?;
    if !output.status.success() {
        return Err("'ss' fallo al listar las conexiones. Puede requerir privilegios elevados para ver el PID de cada proceso.".into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut conns = Vec::new();
    for line in stdout.lines().skip(1) {
        // Netid State Recv-Q Send-Q Local:Port Peer:Port [Process]
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 6 {
            continue;
        }
        let protocol = tokens[0].to_uppercase();
        let state = if protocol == "UDP" { None } else { Some(tokens[1].to_string()) };
        let local_addr = tokens[4].to_string();
        let remote_addr = tokens[5].to_string();
        let pid = line
            .rsplit("pid=")
            .next()
            .and_then(|rest| rest.split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|digits| digits.parse().ok());
        conns.push(ConnectionInfo { protocol, local_addr, remote_addr, state, pid });
    }
    Ok(conns)
}

/// Lists current TCP/UDP connections with local/remote address, state, and
/// owning PID (when the OS reports one) — a structured view for the
/// Network module's table, separate from the raw-text `run_netstat` in the
/// quick-tools panel.
#[tauri::command]
pub fn list_active_connections() -> Result<Vec<ConnectionInfo>, String> {
    list_connections_impl()
}

// ---------------------------------------------------------------------
// Gateway / DNS
// ---------------------------------------------------------------------

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinNetConfigRaw {
    #[serde(rename = "Gateway")]
    gateway: Option<String>,
    #[serde(rename = "Dns")]
    dns: Option<Vec<String>>,
}

#[cfg(target_os = "windows")]
fn get_network_config_impl() -> Result<NetworkConfig, String> {
    let script = "\
        $gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object -Property RouteMetric | Select-Object -First 1 -ExpandProperty NextHop); \
        $dns = (Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses.Count -gt 0 } | Select-Object -First 1 -ExpandProperty ServerAddresses); \
        @{ Gateway = $gw; Dns = @($dns) } | ConvertTo-Json -Compress";

    let output = crate::commands::run_powershell_utf8(script).map_err(|e| format!("No se pudo ejecutar PowerShell: {e}"))?;
    if !output.status.success() {
        return Err("No se pudo leer la configuracion de red.".into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: WinNetConfigRaw = serde_json::from_str(stdout.trim()).unwrap_or(WinNetConfigRaw { gateway: None, dns: None });
    Ok(NetworkConfig { gateway: parsed.gateway, dns_servers: parsed.dns.unwrap_or_default() })
}

#[cfg(not(target_os = "windows"))]
fn get_network_config_impl() -> Result<NetworkConfig, String> {
    let gateway = Command::new("ip")
        .args(["route", "show", "default"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            text.split_whitespace().position(|t| t == "via").and_then(|i| text.split_whitespace().nth(i + 1).map(|s| s.to_string()))
        });

    let dns_servers = std::fs::read_to_string("/etc/resolv.conf")
        .map(|content| {
            content
                .lines()
                .filter_map(|line| line.strip_prefix("nameserver "))
                .map(|s| s.trim().to_string())
                .collect()
        })
        .unwrap_or_default();

    Ok(NetworkConfig { gateway, dns_servers })
}

/// Default gateway and configured DNS servers — the pieces `get_network_info`
/// doesn't cover (it only reports interfaces and cumulative traffic).
#[tauri::command]
pub fn get_network_config() -> Result<NetworkConfig, String> {
    get_network_config_impl()
}

// ---------------------------------------------------------------------
// ARP table — devices this machine has already exchanged traffic with on
// the local network. Purely observational: reads the OS's own ARP cache,
// never sends an ARP request/probe itself.
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct ArpEntry {
    pub ip: String,
    pub mac: String,
    pub interface: Option<String>,
}

#[cfg(target_os = "windows")]
fn list_arp_table_impl() -> Result<Vec<ArpEntry>, String> {
    let output = Command::new("arp").args(["-a"]).output().map_err(|e| format!("No se pudo ejecutar arp: {e}"))?;
    if !output.status.success() {
        return Err("No se pudo leer la tabla ARP.".into());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    let mut current_iface: Option<String> = None;
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Interface:") {
            current_iface = rest.split("---").next().map(|s| s.trim().to_string());
            continue;
        }
        let fields: Vec<&str> = trimmed.split_whitespace().collect();
        // Rows look like: "192.168.1.1     aa-bb-cc-dd-ee-ff     dynamic"
        if fields.len() >= 2 && fields[0].chars().filter(|c| *c == '.').count() == 3 {
            entries.push(ArpEntry { ip: fields[0].to_string(), mac: fields[1].to_string(), interface: current_iface.clone() });
        }
    }
    Ok(entries)
}

#[cfg(not(target_os = "windows"))]
fn list_arp_table_impl() -> Result<Vec<ArpEntry>, String> {
    // /proc/net/arp is read directly rather than shelling out to `arp` or
    // `ip neigh` — no external binary required, and it's always present on
    // Linux regardless of which network-tools package (or none) is
    // installed.
    let content = std::fs::read_to_string("/proc/net/arp").map_err(|e| format!("No se pudo leer /proc/net/arp: {e}"))?;
    Ok(content
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() < 6 {
                return None;
            }
            let mac = fields[3];
            if mac == "00:00:00:00:00:00" {
                return None; // incomplete/unresolved entry
            }
            Some(ArpEntry { ip: fields[0].to_string(), mac: mac.to_string(), interface: Some(fields[5].to_string()) })
        })
        .collect())
}

/// Lists this machine's own ARP cache — devices it has already exchanged
/// traffic with on the local network. This is passive: it reads a table
/// the OS already maintains, it does not send ARP probes or scan the
/// network itself.
#[tauri::command]
pub fn list_arp_table() -> Result<Vec<ArpEntry>, String> {
    list_arp_table_impl()
}
