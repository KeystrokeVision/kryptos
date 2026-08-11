// Mirror the Rust side in src-tauri/src/commands/terminal.rs.

export interface ShellOption {
  id: string;
  label: string;
}

export interface TerminalOutputEvent {
  sessionId: string;
  data: string;
}

export interface TerminalExitEvent {
  sessionId: string;
}
