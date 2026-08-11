// Mirror the Rust side in src-tauri/src/commands/disk_usage.rs.

export interface DirSizeEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size_bytes: number;
  truncated: boolean;
}

export interface DuplicateGroup {
  sha256: string;
  size_bytes: number;
  paths: string[];
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[];
  files_scanned: number;
  truncated: boolean;
}
