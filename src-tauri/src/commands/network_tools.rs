use serde::Serialize;
use std::net::{SocketAddr, ToSocketAddrs};
use std::process::Command;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Serialize)]
pub struct CommandOutput {
    pub success: bool,
    pub output: String,
}

fn run_system_command(program: &str, args: &[&str]) -> CommandOutput {
    match Command::new(program).args(args).output() {
        Ok(out) => {
            let mut text = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.trim().is_empty() {
                text.push_str("\n");
                text.push_str(&stderr);
            }
            CommandOutput { success: out.status.success(), output: text }
        }
        Err(e) => CommandOutput { success: false, output: format!("No se pudo ejecutar '{program}': {e}") },
    }
}

/// Sends a small, fixed number of ICMP echo requests to `host`. Uses the
/// OS's own `ping` binary — same tool any admin already has, just wrapped
/// with a sane default count so it doesn't run forever.
#[tauri::command]
pub fn run_ping(host: String) -> Result<CommandOutput, String> {
    if host.trim().is_empty() {
        return Err("Debes indicar un host o IP.".into());
    }
    #[cfg(target_os = "windows")]
    let result = run_system_command("ping", &["-n", "4", &host]);
    #[cfg(not(target_os = "windows"))]
    let result = run_system_command("ping", &["-c", "4", &host]);
    Ok(result)
}

/// Traces the route to `host` using the OS's native traceroute/tracert.
#[tauri::command]
pub fn run_traceroute(host: String) -> Result<CommandOutput, String> {
    if host.trim().is_empty() {
        return Err("Debes indicar un host o IP.".into());
    }
    #[cfg(target_os = "windows")]
    let result = run_system_command("tracert", &["-h", "20", &host]);
    #[cfg(not(target_os = "windows"))]
    let result = run_system_command("traceroute", &["-m", "20", &host]);
    Ok(result)
}

/// Lists active connections and listening ports on the local machine.
#[tauri::command]
pub fn run_netstat() -> Result<CommandOutput, String> {
    #[cfg(target_os = "windows")]
    let result = run_system_command("netstat", &["-ano"]);
    #[cfg(not(target_os = "windows"))]
    let result = run_system_command("netstat", &["-tulpn"]);
    Ok(result)
}

/// Shows local network interface configuration.
#[tauri::command]
pub fn run_ipconfig() -> Result<CommandOutput, String> {
    #[cfg(target_os = "windows")]
    let result = run_system_command("ipconfig", &["/all"]);
    #[cfg(target_os = "macos")]
    let result = run_system_command("ifconfig", &[]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = run_system_command("ip", &["addr"]);
    Ok(result)
}

#[derive(Serialize)]
pub struct PortCheckResult {
    pub port: u16,
    pub service: String,
    pub open: bool,
}

/// Checks a curated list of common service ports on `host` with a short
/// TCP-connect timeout each. This is an availability check for infrastructure
/// you administer (e.g. "is my SSH/HTTP port reachable"), not a stealth or
/// wide-range scanner: the port set is fixed and small, and every check is a
/// plain, logged TCP handshake — the same thing a browser or an SSH client
/// does when it connects.
#[tauri::command]
pub async fn run_port_check(host: String) -> Result<Vec<PortCheckResult>, String> {
    if host.trim().is_empty() {
        return Err("Debes indicar un host o IP.".into());
    }

    const COMMON_PORTS: &[(u16, &str)] = &[
        (21, "FTP"),
        (22, "SSH"),
        (23, "Telnet"),
        (25, "SMTP"),
        (53, "DNS"),
        (80, "HTTP"),
        (110, "POP3"),
        (143, "IMAP"),
        (443, "HTTPS"),
        (445, "SMB"),
        (3306, "MySQL"),
        (3389, "RDP"),
        (5432, "PostgreSQL"),
        (6379, "Redis"),
        (8080, "HTTP-alt"),
    ];

    let mut results = Vec::with_capacity(COMMON_PORTS.len());

    for (port, service) in COMMON_PORTS {
        let addr_str = format!("{host}:{port}");
        let open = match addr_str.to_socket_addrs() {
            Ok(mut addrs) => {
                if let Some(addr) = addrs.next() {
                    check_port(addr).await
                } else {
                    false
                }
            }
            Err(_) => false,
        };
        results.push(PortCheckResult { port: *port, service: service.to_string(), open });
    }

    Ok(results)
}

async fn check_port(addr: SocketAddr) -> bool {
    matches!(timeout(Duration::from_millis(600), TcpStream::connect(addr)).await, Ok(Ok(_)))
}

// ---------------------------------------------------------------------
// Diagnostico estadistico (mtr-lite): mas pings que el rapido de arriba,
// resumidos en estadisticas reales en vez de un volcado de texto.
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct PingStats {
    pub host: String,
    pub sent: u32,
    pub received: u32,
    pub loss_percent: f64,
    pub min_ms: Option<f64>,
    pub avg_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub raw_output: String,
}

#[cfg(target_os = "windows")]
fn parse_ping_stats(output: &str, host: &str) -> PingStats {
    let mut sent = 0u32;
    let mut received = 0u32;
    let mut loss_percent = 0.0;
    let mut min_ms = None;
    let mut avg_ms = None;
    let mut max_ms = None;

    for line in output.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Packets: ") {
            for part in rest.split(',') {
                let part = part.trim();
                if let Some(v) = part.strip_prefix("Sent = ") {
                    sent = v.trim().parse().unwrap_or(0);
                } else if let Some(v) = part.strip_prefix("Received = ") {
                    received = v.trim().parse().unwrap_or(0);
                } else if part.contains("Lost = ") {
                    if let (Some(a), Some(b)) = (part.find('('), part.find('%')) {
                        loss_percent = part[a + 1..b].trim().parse().unwrap_or(0.0);
                    }
                }
            }
        }
        if line.starts_with("Minimum") {
            for part in line.split(',') {
                let part = part.trim();
                if let Some(v) = part.strip_prefix("Minimum = ") {
                    min_ms = v.trim_end_matches("ms").parse().ok();
                } else if let Some(v) = part.strip_prefix("Maximum = ") {
                    max_ms = v.trim_end_matches("ms").parse().ok();
                } else if let Some(v) = part.strip_prefix("Average = ") {
                    avg_ms = v.trim_end_matches("ms").parse().ok();
                }
            }
        }
    }
    PingStats { host: host.to_string(), sent, received, loss_percent, min_ms, avg_ms, max_ms, raw_output: output.to_string() }
}

#[cfg(not(target_os = "windows"))]
fn parse_ping_stats(output: &str, host: &str) -> PingStats {
    let mut sent = 0u32;
    let mut received = 0u32;
    let mut loss_percent = 0.0;
    let mut min_ms = None;
    let mut avg_ms = None;
    let mut max_ms = None;

    for line in output.lines() {
        let line = line.trim();
        if line.contains("packets transmitted") {
            for part in line.split(',') {
                let part = part.trim();
                if part.ends_with("packets transmitted") {
                    sent = part.split_whitespace().next().unwrap_or("0").parse().unwrap_or(0);
                } else if part.ends_with("received") {
                    received = part.split_whitespace().next().unwrap_or("0").parse().unwrap_or(0);
                } else if part.contains("packet loss") {
                    let num = part.split_whitespace().next().unwrap_or("0%").trim_end_matches('%');
                    loss_percent = num.parse().unwrap_or(0.0);
                }
            }
        }
        if line.contains("min/avg/max") {
            if let Some(rest) = line.split("= ").nth(1) {
                let nums: Vec<&str> = rest.split('/').collect();
                if nums.len() >= 3 {
                    min_ms = nums[0].parse().ok();
                    avg_ms = nums[1].parse().ok();
                    max_ms = nums[2].split_whitespace().next().unwrap_or("").parse().ok();
                }
            }
        }
    }
    PingStats { host: host.to_string(), sent, received, loss_percent, min_ms, avg_ms, max_ms, raw_output: output.to_string() }
}

/// Runs a heavier round of pings (10, vs. the quick tool's 4) and parses
/// the OS's own summary line into real numbers — a lightweight stand-in
/// for `mtr`'s "how reliable is this link" view, without needing raw
/// sockets or a bundled third-party binary.
#[tauri::command]
pub fn run_ping_diagnostic(host: String) -> Result<PingStats, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("Debes indicar un host o IP.".into());
    }
    #[cfg(target_os = "windows")]
    let result = run_system_command("ping", &["-n", "10", &host]);
    #[cfg(not(target_os = "windows"))]
    let result = run_system_command("ping", &["-c", "10", &host]);

    if !result.success && result.output.trim().is_empty() {
        return Err(format!("No se pudo hacer ping a '{host}'."));
    }
    Ok(parse_ping_stats(&result.output, &host))
}
