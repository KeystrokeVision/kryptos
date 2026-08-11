// Mirror the Rust side in src-tauri/src/commands/ssh.rs.

export interface SshProfile {
  id: number;
  label: string;
  host: string;
  port: number;
  username: string;
  auth_method: "password" | "key";
  key_path: string | null;
}

export interface SshConnectParams {
  host: string;
  port: number;
  username: string;
  auth_method: "password" | "key";
  password?: string;
  key_path?: string;
  passphrase?: string;
}

export interface SshOutputEvent {
  sessionId: string;
  data: string;
}

export interface SshExitEvent {
  sessionId: string;
  errorMessage: string | null;
}

export interface SftpEntry {
  name: string;
  is_dir: boolean;
  size_bytes: number;
  modified_unix: number;
}
