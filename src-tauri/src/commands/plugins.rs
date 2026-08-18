use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;
use walkdir::WalkDir;

use crate::commands::apps::{copy_dir_recursive, extract_zip, sanitize_id};
use crate::commands::audit::record_audit_event;
use crate::db::Db;

// ---------------------------------------------------------------------
// Plugins — third-party mini-tools bundled as a single self-contained
// HTML file (inline CSS/JS, data-URI images) plus a `plugin.json`
// manifest declaring name/version/description/author/icon/entry. Same
// two-step import as Scripts (import_plugin_source -> finalize, or
// cancel) into KRYPTOS's own portable data root.
//
// Deliberately narrow security model, consistent with the rest of the
// app ("nada se ejecuta a ciegas"):
//   - A plugin is rendered inside a *sandboxed* iframe via `srcdoc`
//     (frontend), built from the raw HTML text this module returns —
//     never loaded through the filesystem/asset protocol, so it never
//     gets a `file://`/`asset://` origin or any KRYPTOS-side fs scope.
//   - `sandbox="allow-scripts"` (see PluginFrame.tsx) grants script
//     execution only — no same-origin, no top navigation, no forms, no
//     popups. The iframe never receives `window.__TAURI__`: nothing is
//     injected into it, so a plugin cannot call any Tauri command,
//     touch the filesystem, or reach the network beyond what a normal
//     sandboxed `<iframe>` already permits the browser engine to do.
//   - Because the whole plugin must fit in one HTML file, there is no
//     companion-asset surface (no relative `<script src>`/`<link>` to
//     validate) and nothing to path-traverse outside its own folder.
// ---------------------------------------------------------------------

const MAX_MANIFEST_BYTES: u64 = 64 * 1024; // 64 KB — plenty for a JSON manifest
const MAX_ENTRY_BYTES: u64 = 3 * 1024 * 1024; // 3 MB — a single self-contained HTML file

#[derive(Deserialize)]
struct PluginManifestFile {
    name: String,
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    author: Option<String>,
    /// A single emoji/short glyph shown instead of the generic plugin
    /// icon — not a file, so no icon-copy step is needed.
    #[serde(default)]
    icon: Option<String>,
    /// Path to the entry `.html` file, relative to `plugin.json`'s own
    /// folder.
    entry: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PluginEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    pub icon: Option<String>,
    pub enabled: bool,
    pub installed_at_unix: u64,
}

#[derive(Serialize)]
pub struct PluginManifestPreview {
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    pub icon: Option<String>,
}

#[derive(Serialize)]
pub struct PluginImportResult {
    pub import_id: String,
    pub manifest: PluginManifestPreview,
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn unique_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("plugin-{nanos}")
}

fn plugins_dir() -> Result<PathBuf, String> {
    let dir = crate::commands::portable_data_root()?.join("plugins");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de plugins: {e}"))?;
    Ok(dir)
}

fn plugin_files_dir() -> Result<PathBuf, String> {
    let dir = plugins_dir()?.join("files");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de archivos de plugins: {e}"))?;
    Ok(dir)
}

/// Scratch space for an import in progress, mirroring
/// `scripts::imports_dir` — cleared out by `finalize_plugin_import` or
/// `cancel_plugin_import`.
fn imports_dir() -> Result<PathBuf, String> {
    let dir = plugins_dir()?.join("imports");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio temporal de importacion: {e}"))?;
    Ok(dir)
}

fn plugins_file() -> Result<PathBuf, String> {
    Ok(plugins_dir()?.join("plugins.json"))
}

fn load_plugins() -> Result<Vec<PluginEntry>, String> {
    let path = plugins_file()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("No se pudo leer la lista de plugins: {e}"))?;
    if content.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&content).map_err(|e| format!("La lista de plugins esta corrupta: {e}"))
}

fn save_plugins(plugins: &[PluginEntry]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(plugins).map_err(|e| format!("No se pudo preparar la lista de plugins: {e}"))?;
    fs::write(plugins_file()?, json).map_err(|e| format!("No se pudo guardar la lista de plugins: {e}"))
}

/// Finds `plugin.json` anywhere under `root` (a zip downloaded straight
/// from GitHub, for example, usually wraps everything in one extra
/// top-level folder) and returns it, preferring the shallowest match.
fn find_manifest(root: &Path) -> Option<PathBuf> {
    WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.file_name().to_str() == Some("plugin.json"))
        .min_by_key(|e| e.depth())
        .map(|e| e.path().to_path_buf())
}

fn parse_manifest(manifest_path: &Path) -> Result<PluginManifestFile, String> {
    let meta = fs::metadata(manifest_path).map_err(|e| format!("No se pudo leer 'plugin.json': {e}"))?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err("'plugin.json' es demasiado grande para ser un manifiesto valido.".into());
    }
    let content = fs::read_to_string(manifest_path).map_err(|e| format!("No se pudo leer 'plugin.json': {e}"))?;
    let manifest: PluginManifestFile =
        serde_json::from_str(&content).map_err(|e| format!("'plugin.json' no es JSON valido: {e}"))?;
    if manifest.name.trim().is_empty() {
        return Err("El manifiesto no tiene 'name'.".into());
    }
    if manifest.version.trim().is_empty() {
        return Err("El manifiesto no tiene 'version'.".into());
    }
    if manifest.entry.trim().is_empty() {
        return Err("El manifiesto no tiene 'entry' (el archivo .html a cargar).".into());
    }
    Ok(manifest)
}

/// Resolves and validates `entry` against `manifest_dir`: must stay
/// inside it (no `..`/absolute-path escape) and end in `.html`.
fn resolve_entry(manifest_dir: &Path, entry: &str) -> Result<PathBuf, String> {
    let manifest_dir_canon = fs::canonicalize(manifest_dir).map_err(|e| format!("No se pudo resolver el plugin: {e}"))?;
    let candidate = manifest_dir.join(entry.trim().replace('/', std::path::MAIN_SEPARATOR_STR));
    let candidate_canon =
        fs::canonicalize(&candidate).map_err(|_| "El archivo 'entry' del manifiesto no existe.".to_string())?;
    if !candidate_canon.starts_with(&manifest_dir_canon) || !candidate_canon.is_file() {
        return Err("El archivo 'entry' del manifiesto es invalido.".into());
    }
    if candidate_canon.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()) != Some("html".to_string()) {
        return Err("'entry' debe ser un archivo .html — un plugin es un solo HTML autocontenido (CSS/JS inline).".into());
    }
    Ok(candidate_canon)
}

/// Lists every installed plugin (enabled or not).
#[tauri::command]
pub fn list_plugins() -> Result<Vec<PluginEntry>, String> {
    load_plugins()
}

/// Step 1: copies a file/folder/.zip into a scratch folder and validates
/// it contains a well-formed `plugin.json` pointing at a real `.html`
/// entry. Nothing is installed yet.
#[tauri::command]
pub fn import_plugin_source(source_path: String) -> Result<PluginImportResult, String> {
    let source_path = source_path.trim().to_string();
    if source_path.is_empty() {
        return Err("Elige una carpeta o un .zip con un plugin.json adentro.".into());
    }
    let src = Path::new(&source_path);
    if !src.exists() {
        return Err(format!("No se encontro '{source_path}'."));
    }

    let id = unique_id();
    let dest = imports_dir()?.join(&id);

    let is_zip = src.is_file() && src.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    let import_result = if is_zip {
        extract_zip(src, &dest)
    } else if src.is_dir() {
        copy_dir_recursive(src, &dest)
    } else {
        Err("Elige una carpeta o un .zip con un plugin.json adentro.".into())
    };

    if let Err(e) = import_result {
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }

    let Some(manifest_path) = find_manifest(&dest) else {
        let _ = fs::remove_dir_all(&dest);
        return Err("No se encontro 'plugin.json' ahi dentro.".into());
    };
    let manifest = match parse_manifest(&manifest_path) {
        Ok(m) => m,
        Err(e) => {
            let _ = fs::remove_dir_all(&dest);
            return Err(e);
        }
    };
    let manifest_dir = manifest_path.parent().unwrap_or(&dest);
    if let Err(e) = resolve_entry(manifest_dir, &manifest.entry) {
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }

    Ok(PluginImportResult {
        import_id: id,
        manifest: PluginManifestPreview {
            name: manifest.name.trim().to_string(),
            version: manifest.version.trim().to_string(),
            description: manifest.description.trim().to_string(),
            author: manifest.author.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()),
            icon: manifest.icon.map(|i| i.trim().to_string()).filter(|i| !i.is_empty()),
        },
    })
}

/// Discards an in-progress import.
#[tauri::command]
pub fn cancel_plugin_import(import_id: String) -> Result<(), String> {
    let safe_id = sanitize_id(&import_id)?;
    let dir = imports_dir()?.join(safe_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("No se pudo limpiar los archivos temporales: {e}"))?;
    }
    Ok(())
}

/// Step 2: moves the scratch copy into permanent storage and records it
/// as an installed, enabled-by-default plugin. Re-reads and re-validates
/// the manifest instead of trusting the preview from step 1, in case the
/// folder changed on disk in between.
#[tauri::command]
pub fn finalize_plugin_import(import_id: String) -> Result<PluginEntry, String> {
    let safe_id = sanitize_id(&import_id)?;
    let import_root = imports_dir()?.join(&safe_id);
    if !import_root.exists() {
        return Err("Esa importacion ya no esta disponible; vuelve a importarla.".into());
    }

    let manifest_path = find_manifest(&import_root).ok_or_else(|| "No se encontro 'plugin.json' ahi dentro.".to_string())?;
    let manifest = parse_manifest(&manifest_path)?;
    let manifest_dir = manifest_path.parent().unwrap_or(&import_root).to_path_buf();
    resolve_entry(&manifest_dir, &manifest.entry)?;

    // The permanent copy is rooted at the manifest's own folder (which
    // may be nested one level inside a zip's wrapping folder), so
    // `entry` always resolves the same way relative to it afterwards.
    let permanent_dir = plugin_files_dir()?.join(&safe_id);
    if permanent_dir.exists() {
        let _ = fs::remove_dir_all(&permanent_dir);
    }
    if manifest_dir == import_root {
        if fs::rename(&import_root, &permanent_dir).is_err() {
            copy_dir_recursive(&import_root, &permanent_dir)?;
            let _ = fs::remove_dir_all(&import_root);
        }
    } else {
        copy_dir_recursive(&manifest_dir, &permanent_dir)?;
        let _ = fs::remove_dir_all(&import_root);
    }

    let entry = PluginEntry {
        id: safe_id,
        name: manifest.name.trim().to_string(),
        version: manifest.version.trim().to_string(),
        description: manifest.description.trim().to_string(),
        author: manifest.author.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()),
        icon: manifest.icon.map(|i| i.trim().to_string()).filter(|i| !i.is_empty()),
        enabled: true,
        installed_at_unix: unix_now(),
    };

    let mut plugins = load_plugins()?;
    plugins.retain(|p| p.id != entry.id);
    plugins.push(entry.clone());
    save_plugins(&plugins)?;
    Ok(entry)
}

/// Turns a plugin on/off without uninstalling it. A disabled plugin
/// stays listed (greyed out in the UI) but its iframe never mounts.
#[tauri::command]
pub fn set_plugin_enabled(id: String, enabled: bool) -> Result<PluginEntry, String> {
    let mut plugins = load_plugins()?;
    let idx = plugins.iter().position(|p| p.id == id).ok_or_else(|| "Plugin no encontrado.".to_string())?;
    plugins[idx].enabled = enabled;
    let updated = plugins[idx].clone();
    save_plugins(&plugins)?;
    Ok(updated)
}

/// Uninstalls a plugin: removes it from the list and deletes our copy of
/// its files.
#[tauri::command]
pub fn delete_plugin(id: String, db: State<'_, Db>) -> Result<(), String> {
    let mut plugins = load_plugins()?;
    if let Some(pos) = plugins.iter().position(|p| p.id == id) {
        let removed = plugins.remove(pos);
        if let Ok(dir) = plugin_files_dir() {
            let _ = fs::remove_dir_all(dir.join(&removed.id));
        }
        save_plugins(&plugins)?;
        record_audit_event(&db, "delete_plugin", &removed.name, "ok", None);
    }
    Ok(())
}

/// Returns the plugin's entry HTML as raw text, so the frontend can load
/// it into a sandboxed `<iframe srcDoc>` — never through the filesystem
/// or asset protocol (see the module doc-comment for why).
#[tauri::command]
pub fn get_plugin_html(id: String) -> Result<String, String> {
    let safe_id = sanitize_id(&id)?;
    let plugins = load_plugins()?;
    let entry = plugins.iter().find(|p| p.id == safe_id).ok_or_else(|| "Plugin no encontrado.".to_string())?;

    let dir = plugin_files_dir()?.join(&safe_id);
    let manifest_path = find_manifest(&dir).ok_or_else(|| "El manifiesto del plugin ya no esta.".to_string())?;
    let manifest = parse_manifest(&manifest_path)?;
    let manifest_dir = manifest_path.parent().unwrap_or(&dir);
    let entry_path = resolve_entry(manifest_dir, &manifest.entry)?;

    let meta = fs::metadata(&entry_path).map_err(|e| format!("No se pudo leer el plugin: {e}"))?;
    if meta.len() > MAX_ENTRY_BYTES {
        return Err(format!("'{}' supera el limite de 3 MB para un plugin de un solo archivo.", entry.name));
    }
    fs::read_to_string(&entry_path).map_err(|e| format!("No se pudo leer el plugin: {e}"))
}

/// Installs the handful of example plugins bundled with KRYPTOS
/// (`src-tauri/resources/plugins/`) the very first time the app runs —
/// so "Plugins" isn't an empty page nobody knows what to do with, and so
/// there's always at least one real, working example to read next to
/// `plugin.json`'s own docs. Only runs once: if `plugins.json` already
/// exists (even as an empty list, meaning someone already
/// installed/uninstalled something), this is a no-op, so deleting the
/// bundled examples sticks.
pub fn seed_default_plugins(app: &tauri::AppHandle) {
    use tauri::Manager;

    if plugins_file().map(|p| p.exists()).unwrap_or(true) {
        return;
    }
    let Ok(resource_dir) = app.path().resource_dir() else { return };
    let bundled_root = resource_dir.join("plugins");
    if !bundled_root.is_dir() {
        return;
    }

    let mut entries = Vec::new();
    let Ok(read_dir) = fs::read_dir(&bundled_root) else { return };
    for item in read_dir.flatten() {
        if !item.path().is_dir() {
            continue;
        }
        let Ok(folder_name) = sanitize_id(&item.file_name().to_string_lossy()) else { continue };
        let item_path = item.path();
        let Some(manifest_path) = find_manifest(&item_path) else { continue };
        let Ok(manifest) = parse_manifest(&manifest_path) else { continue };
        let manifest_dir = manifest_path.parent().unwrap_or(&item_path);
        if resolve_entry(manifest_dir, &manifest.entry).is_err() {
            continue;
        }

        let permanent_dir = match plugin_files_dir() {
            Ok(dir) => dir.join(&folder_name),
            Err(_) => continue,
        };
        if copy_dir_recursive(manifest_dir, &permanent_dir).is_err() {
            continue;
        }

        entries.push(PluginEntry {
            id: folder_name,
            name: manifest.name.trim().to_string(),
            version: manifest.version.trim().to_string(),
            description: manifest.description.trim().to_string(),
            author: manifest.author.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()),
            icon: manifest.icon.map(|i| i.trim().to_string()).filter(|i| !i.is_empty()),
            enabled: true,
            installed_at_unix: unix_now(),
        });
    }

    // Written even if `entries` ends up empty (e.g. resources missing in
    // this build), so this only ever runs once regardless.
    let _ = save_plugins(&entries);
}

/// Opens the folder holding a plugin's files, same convention as
/// `scripts::open_script_folder`.
#[tauri::command]
pub fn open_plugin_folder(id: String) -> Result<(), String> {
    let safe_id = sanitize_id(&id)?;
    let dir = plugin_files_dir()?.join(&safe_id);
    if !dir.exists() {
        return Err("Plugin no encontrado.".into());
    }
    open::that(dir).map_err(|e| format!("No se pudo abrir la carpeta: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_plugin_dir() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("kryptos-plugin-test-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("plugin.json"),
            r#"{"name":"Contador de prueba","version":"1.0.0","description":"Un plugin de prueba.","author":"Test","icon":"🧮","entry":"index.html"}"#,
        )
        .unwrap();
        fs::write(dir.join("index.html"), "<html><body><h1>Hola desde el plugin</h1></body></html>").unwrap();
        dir
    }

    /// End-to-end: import -> finalize -> list -> get_plugin_html ->
    /// set_plugin_enabled, all against a real folder on disk, exercising
    /// the exact validation path a real install goes through (no mocking
    /// of manifest parsing, zip/copy, or path resolution).
    #[test]
    fn plugin_install_lifecycle() {
        let source = sample_plugin_dir();

        let import = import_plugin_source(source.to_string_lossy().to_string()).expect("import should succeed");
        assert_eq!(import.manifest.name, "Contador de prueba");
        assert_eq!(import.manifest.version, "1.0.0");
        assert_eq!(import.manifest.icon.as_deref(), Some("🧮"));

        let installed = finalize_plugin_import(import.import_id).expect("finalize should succeed");
        assert_eq!(installed.name, "Contador de prueba");
        assert!(installed.enabled);

        let listed = list_plugins().expect("list should succeed");
        assert!(listed.iter().any(|p| p.id == installed.id));

        let html = get_plugin_html(installed.id.clone()).expect("html should be readable");
        assert!(html.contains("Hola desde el plugin"));

        let toggled = set_plugin_enabled(installed.id.clone(), false).expect("toggle should succeed");
        assert!(!toggled.enabled);
        let relisted = list_plugins().unwrap();
        assert!(!relisted.iter().find(|p| p.id == installed.id).unwrap().enabled);

        // Cleanup: this test writes into portable_data_root() (tied to
        // the test binary's own path), so remove what it added instead
        // of leaving it for the next run.
        let mut plugins = load_plugins().unwrap();
        plugins.retain(|p| p.id != installed.id);
        save_plugins(&plugins).unwrap();
        let _ = fs::remove_dir_all(plugin_files_dir().unwrap().join(&installed.id));
        let _ = fs::remove_dir_all(&source);
    }

    #[test]
    fn rejects_manifest_without_entry() {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("kryptos-plugin-badtest-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("plugin.json"), r#"{"name":"Malo","version":"1.0.0","entry":"no-existe.html"}"#).unwrap();

        let result = import_plugin_source(dir.to_string_lossy().to_string());
        assert!(result.is_err(), "importing a manifest whose entry file doesn't exist must fail");

        let _ = fs::remove_dir_all(&dir);
    }
}
