// Mirror the Rust side in src-tauri/src/commands/users.rs.

export interface UserAccount {
  username: string;
  description: string | null;
  enabled: boolean | null;
  is_system: boolean;
  home_dir: string | null;
}
