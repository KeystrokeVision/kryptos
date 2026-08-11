// Mirror the Rust side in src-tauri/src/commands/network_details.rs.

export interface ConnectionInfo {
  protocol: string;
  local_addr: string;
  remote_addr: string;
  state: string | null;
  pid: number | null;
}

export interface NetworkConfig {
  gateway: string | null;
  dns_servers: string[];
}

export interface ArpEntry {
  ip: string;
  mac: string;
  interface: string | null;
}

export interface PingStats {
  host: string;
  sent: number;
  received: number;
  loss_percent: number;
  min_ms: number | null;
  avg_ms: number | null;
  max_ms: number | null;
  raw_output: string;
}
