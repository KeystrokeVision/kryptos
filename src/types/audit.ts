// Mirror the Rust side in src-tauri/src/commands/audit.rs.

export interface AuditEntry {
  id: number;
  timestamp_unix: number;
  action: string;
  target: string;
  result: string;
  details: string | null;
}
