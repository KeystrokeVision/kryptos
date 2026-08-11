// Mirror the Rust side in src-tauri/src/commands/persistence.rs.

export interface ScheduledTaskInfo {
  name: string;
  source: string;
  schedule: string | null;
  command: string;
  enabled: boolean | null;
}
