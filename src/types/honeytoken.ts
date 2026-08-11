// Mirror the Rust side in src-tauri/src/commands/honeytoken.rs.

export interface HoneytokenInfo {
  id: number;
  path: string;
  label: string;
  created_at_unix: number;
  armed: boolean;
}
