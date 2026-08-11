// Mirror the Rust side in src-tauri/src/commands/file_watch.rs.

export interface FileWatchEvent {
  watchId: string;
  kind: "created" | "modified" | "removed" | "error";
  paths: string[];
}
