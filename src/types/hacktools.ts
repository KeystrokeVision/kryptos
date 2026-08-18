// Mirror the Rust side in src-tauri/src/commands/hacktools.rs.

export type ToolAction = "dedicated" | "launch_bare" | "launch_gui" | "run_target" | "run_local" | "open_url" | "docs_only";

export interface ExternalToolStatus {
  id: string;
  name: string;
  category: string;
  description: string;
  docs_url: string;
  action: ToolAction;
  installed: boolean;
  detail: string | null;
  command_preview: string;
  winget_id: string | null;
  pip_installable: boolean;
}

export interface HacktoolRunResult {
  success: boolean;
  output: string;
}
