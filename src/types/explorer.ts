// Mirror the Rust side in src-tauri/src/commands/explorer.rs.

export interface DirEntryInfo {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size_bytes: number;
  modified_unix: number;
  is_hidden: boolean;
}

export interface DriveInfo {
  path: string;
  label: string;
  total_bytes: number;
  available_bytes: number;
  removable: boolean;
}

export interface FavoriteEntry {
  id: number;
  path: string;
  label: string;
  added_at_unix: number;
}
