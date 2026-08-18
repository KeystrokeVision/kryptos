// Mirror the Rust side in src-tauri/src/commands/scripts.rs.

export interface ScriptEntry {
  id: string;
  name: string;
  script_path: string;
  icon_file: string | null;
  repo_url: string | null;
  added_at_unix: number;
}

export interface ScriptRunResult {
  success: boolean;
  output: string;
}

export interface ScriptImportResult {
  import_id: string;
  candidates: string[];
  guessed_script: string | null;
}
