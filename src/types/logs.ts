// Mirror the Rust side in src-tauri/src/commands/logs.rs.

export interface LogEntry {
  time: string | null;
  level: string | null;
  source: string | null;
  message: string;
}
