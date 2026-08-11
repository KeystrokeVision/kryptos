use serde::Serialize;
use sysinfo::{Disks, Networks, Pid, ProcessesToUpdate, System};

/// Snapshot of overall system health, backing the Dashboard and status bar.
/// All values come directly from `sysinfo` — nothing here is mocked.
#[derive(Serialize)]
pub struct SystemSnapshot {
    pub hostname: String,
    pub os_name: String,
    pub os_version: String,
    pub uptime_secs: u64,
    pub cpu_usage_percent: f32,
    pub cpu_name: String,
    pub cpu_cores: usize,
    pub ram_used_bytes: u64,
    pub ram_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub process_count: usize,
}

#[derive(Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage_percent: f32,
    pub memory_bytes: u64,
    pub status: String,
}

#[derive(Serialize)]
pub struct NetworkInterfaceInfo {
    pub name: String,
    pub ipv4: Vec<String>,
    pub ipv6: Vec<String>,
    pub mac: String,
    pub received_bytes: u64,
    pub transmitted_bytes: u64,
}

#[derive(Serialize)]
pub struct NetworkInfo {
    pub hostname: String,
    pub interfaces: Vec<NetworkInterfaceInfo>,
}

/// Returns a fresh snapshot of CPU, RAM, disk and process counts.
/// Called on a poll interval from the frontend (Dashboard, status bar).
#[tauri::command]
pub fn get_system_snapshot() -> Result<SystemSnapshot, String> {
    let mut sys = System::new_all();
    // sysinfo requires two refreshes with a short gap for an accurate CPU
    // delta; a single refresh on first launch can read 0%. Callers poll on
    // an interval, so a single refresh per call is acceptable here and
    // avoids blocking the command thread for long.
    sys.refresh_all();

    let disks = Disks::new_with_refreshed_list();
    let (disk_used, disk_total) = disks.list().iter().fold((0u64, 0u64), |(used, total), d| {
        let t = d.total_space();
        let avail = d.available_space();
        (used + t.saturating_sub(avail), total + t)
    });

    let cpu_usage = sys.global_cpu_usage();
    let cpu_name = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "CPU desconocida".to_string());

    Ok(SystemSnapshot {
        hostname: System::host_name().unwrap_or_else(|| "desconocido".to_string()),
        os_name: System::name().unwrap_or_else(|| "Desconocido".to_string()),
        os_version: System::os_version().unwrap_or_default(),
        uptime_secs: System::uptime(),
        cpu_usage_percent: cpu_usage,
        cpu_name,
        cpu_cores: sys.cpus().len(),
        ram_used_bytes: sys.used_memory(),
        ram_total_bytes: sys.total_memory(),
        disk_used_bytes: disk_used,
        disk_total_bytes: disk_total,
        process_count: sys.processes().len(),
    })
}

/// Lists all currently running processes. Backs the Procesos module and the
/// Dashboard's top-consumers table.
#[tauri::command]
pub fn list_processes() -> Result<Vec<ProcessInfo>, String> {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let processes = sys
        .processes()
        .values()
        .map(|p| ProcessInfo {
            pid: p.pid().as_u32(),
            name: p.name().to_string_lossy().to_string(),
            cpu_usage_percent: p.cpu_usage(),
            memory_bytes: p.memory(),
            status: p.status().to_string(),
        })
        .collect();

    Ok(processes)
}

/// Terminates a process by PID. The frontend is responsible for confirming
/// this with the user before calling — this command performs the action
/// only, it never runs unattended.
#[tauri::command]
pub fn kill_process(pid: u32, db: tauri::State<'_, crate::db::Db>) -> Result<(), String> {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    match sys.process(Pid::from_u32(pid)) {
        Some(process) => {
            let target = format!("{} (pid {pid})", process.name().to_string_lossy());
            if process.kill() {
                crate::commands::audit::record_audit_event(&db, "kill_process", &target, "ok", None);
                Ok(())
            } else {
                crate::commands::audit::record_audit_event(&db, "kill_process", &target, "error", Some("kill() devolvio false"));
                Err(format!("No se pudo finalizar el proceso {pid}. Verifica los permisos."))
            }
        }
        None => Err(format!("Proceso {pid} no encontrado.")),
    }
}

/// Reports local network interfaces: IPs, MAC address, and cumulative
/// traffic counters. Backs the Red module.
#[tauri::command]
pub fn get_network_info() -> Result<NetworkInfo, String> {
    let networks = Networks::new_with_refreshed_list();

    let interfaces = networks
        .iter()
        .map(|(name, data)| NetworkInterfaceInfo {
            name: name.clone(),
            ipv4: data
                .ip_networks()
                .iter()
                .filter(|ip| ip.addr.is_ipv4())
                .map(|ip| ip.addr.to_string())
                .collect(),
            ipv6: data
                .ip_networks()
                .iter()
                .filter(|ip| ip.addr.is_ipv6())
                .map(|ip| ip.addr.to_string())
                .collect(),
            mac: data.mac_address().to_string(),
            received_bytes: data.total_received(),
            transmitted_bytes: data.total_transmitted(),
        })
        .collect();

    Ok(NetworkInfo {
        hostname: System::host_name().unwrap_or_else(|| "desconocido".to_string()),
        interfaces,
    })
}
