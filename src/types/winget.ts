// Mirror the Rust side in src-tauri/src/commands/winget.rs.

export interface WingetPackage {
  name: string;
  id: string;
  version: string;
}
