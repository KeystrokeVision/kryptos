// These mirror the Serde structs in src-tauri/src/commands/system.rs exactly.
// Keep both sides in sync when a field changes.

export interface SystemSnapshot {
  hostname: string;
  os_name: string;
  os_version: string;
  uptime_secs: number;
  cpu_usage_percent: number;
  cpu_name: string;
  cpu_cores: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  process_count: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu_usage_percent: number;
  memory_bytes: number;
  status: string;
}

export interface NetworkInfo {
  hostname: string;
  interfaces: NetworkInterface[];
}

export interface NetworkInterface {
  name: string;
  ipv4: string[];
  ipv6: string[];
  mac: string;
  received_bytes: number;
  transmitted_bytes: number;
}
