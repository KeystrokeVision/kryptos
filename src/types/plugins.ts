// Mirror the Rust side in src-tauri/src/commands/plugins.rs.

export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string | null;
  icon: string | null;
  enabled: boolean;
  installed_at_unix: number;
}

export interface PluginManifestPreview {
  name: string;
  version: string;
  description: string;
  author: string | null;
  icon: string | null;
}

export interface PluginImportResult {
  import_id: string;
  manifest: PluginManifestPreview;
}
