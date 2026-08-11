// Mirror the Rust side in src-tauri/src/commands/services.rs.

export interface ServiceInfo {
  name: string;
  display_name: string;
  status: string;
  start_type: string | null;
}
