// Mirror the Rust side in src-tauri/src/commands/apps.rs.

export interface AppEntry {
  id: string;
  name: string;
  exe_path: string;
  icon_file: string | null;
  added_at_unix: number;
}

export interface DiscoveredApp {
  name: string;
  exec_path: string;
}
