use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

const ALLOWED_ICON_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"];

#[derive(Serialize, Deserialize, Clone)]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    pub exe_path: String,
    /// Filename only (not a full path) inside the icons directory — the
    /// original file the user picked may move or be deleted later, so we
    /// keep our own copy instead of depending on it.
    pub icon_file: Option<String>,
    pub added_at_unix: u64,
    /// True when `exe_path` points inside our own `portable_apps/<id>/`
    /// storage (imported via `import_portable_source` +
    /// `finalize_portable_app`) rather than at a program installed
    /// elsewhere. Older entries predate this field, hence the default.
    #[serde(default)]
    pub is_portable: bool,
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn unique_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("app-{nanos}")
}

/// Launcher storage lives under KRYPTOS's own portable data root (next to
/// the executable, see `commands::portable_data_root`) so it travels with
/// the app when shared, rather than in this Windows profile's `%APPDATA%`.
fn apps_dir() -> Result<PathBuf, String> {
    let dir = crate::commands::portable_data_root()?.join("apps");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de aplicaciones: {e}"))?;
    migrate_legacy_apps_data(&dir);
    Ok(dir)
}

/// One-time convenience migration for anyone who added apps before this
/// storage moved from `%APPDATA%\kryptos` to the portable data root: copies
/// just the launcher's own files (apps.json, icons, imported portable
/// programs) into the new location, leaving the audit log and everything
/// else that intentionally stays in the Windows profile untouched. No-ops
/// once `dir` already has its own apps.json.
fn migrate_legacy_apps_data(dir: &Path) {
    if dir.join("apps.json").exists() {
        return;
    }
    let Some(legacy_root) = dirs::config_dir().map(|c| c.join("kryptos")) else { return };
    let legacy_apps_file = legacy_root.join("apps.json");
    if !legacy_apps_file.exists() {
        return;
    }
    let _ = fs::copy(&legacy_apps_file, dir.join("apps.json"));
    let legacy_icons = legacy_root.join("app_icons");
    if legacy_icons.is_dir() {
        let _ = copy_dir_recursive(&legacy_icons, &dir.join("app_icons"));
    }
    let legacy_portable = legacy_root.join("portable_apps");
    if legacy_portable.is_dir() {
        let _ = copy_dir_recursive(&legacy_portable, &dir.join("portable_apps"));
    }
}

fn icons_dir() -> Result<PathBuf, String> {
    let dir = apps_dir()?.join("app_icons");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de iconos: {e}"))?;
    Ok(dir)
}

/// Where imported portable programs live — each gets its own `<id>/`
/// subfolder holding a full copy of the program, so it survives the
/// original folder/zip moving, being deleted, or living on a USB drive
/// that gets unplugged.
fn portable_apps_dir() -> Result<PathBuf, String> {
    let dir = apps_dir()?.join("portable_apps");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de programas portables: {e}"))?;
    Ok(dir)
}

fn apps_file() -> Result<PathBuf, String> {
    Ok(apps_dir()?.join("apps.json"))
}

fn load_apps() -> Result<Vec<AppEntry>, String> {
    let path = apps_file()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("No se pudo leer la lista de aplicaciones: {e}"))?;
    if content.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&content).map_err(|e| format!("La lista de aplicaciones esta corrupta: {e}"))
}

fn save_apps(apps: &[AppEntry]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(apps).map_err(|e| format!("No se pudo preparar la lista de aplicaciones: {e}"))?;
    fs::write(apps_file()?, json).map_err(|e| format!("No se pudo guardar la lista de aplicaciones: {e}"))
}

fn copy_icon(id: &str, src_path: &str) -> Result<String, String> {
    let src = Path::new(src_path);
    if !src.exists() {
        return Err(format!("No se encontro la imagen '{src_path}'."));
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !ALLOWED_ICON_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "Formato de imagen no soportado: '.{ext}'. Usa png, jpg, jpeg, webp, gif, bmp o ico."
        ));
    }
    let dest = icons_dir()?.join(format!("{id}.{ext}"));
    fs::copy(src, &dest).map_err(|e| format!("No se pudo copiar la imagen: {e}"))?;
    Ok(dest.file_name().unwrap().to_string_lossy().to_string())
}

fn remove_icon_if_present(icon_file: &Option<String>) {
    if let (Some(file), Ok(dir)) = (icon_file, icons_dir()) {
        let _ = fs::remove_file(dir.join(file));
    }
}

/// Lists every registered application shortcut.
#[tauri::command]
pub fn list_applications() -> Result<Vec<AppEntry>, String> {
    load_apps()
}

fn is_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

/// Registers a new application: validates the executable actually exists,
/// optionally copies a user-picked image as its icon (our own copy, so it
/// survives the original file moving or being deleted), and persists it.
/// If `exe_path` is a `http(s)://` URL, it's stored as a web shortcut
/// instead — the frontend opens those with the system's default browser
/// rather than spawning a process.
#[tauri::command]
pub fn add_application(name: String, exe_path: String, icon_source_path: Option<String>) -> Result<AppEntry, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Ponle un nombre a la aplicacion.".into());
    }
    let exe_path = exe_path.trim().to_string();
    if !is_url(&exe_path) {
        let exe = Path::new(&exe_path);
        if !exe.exists() {
            return Err(format!("No se encontro el archivo '{exe_path}'."));
        }
        if !exe.is_file() {
            return Err("La ruta indicada no es un archivo ejecutable.".into());
        }
    }

    let id = unique_id();
    let icon_file = match icon_source_path {
        Some(src) if !src.trim().is_empty() => Some(copy_icon(&id, src.trim())?),
        _ => None,
    };

    let entry = AppEntry { id, name, exe_path, icon_file, added_at_unix: unix_now(), is_portable: false };

    let mut apps = load_apps()?;
    apps.push(entry.clone());
    save_apps(&apps)?;
    Ok(entry)
}

/// Updates an existing entry's name/path/icon. Passing `None` for the icon
/// leaves the current one untouched; to remove an icon entirely, delete and
/// re-add the entry.
#[tauri::command]
pub fn update_application(id: String, name: String, exe_path: String, icon_source_path: Option<String>) -> Result<AppEntry, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Ponle un nombre a la aplicacion.".into());
    }
    let exe_path = exe_path.trim().to_string();
    if !is_url(&exe_path) {
        let exe = Path::new(&exe_path);
        if !exe.exists() {
            return Err(format!("No se encontro el archivo '{exe_path}'."));
        }
    }

    let mut apps = load_apps()?;
    let entry_idx = apps.iter().position(|a| a.id == id).ok_or_else(|| "Aplicacion no encontrada.".to_string())?;

    let icon_file = match icon_source_path {
        Some(src) if !src.trim().is_empty() => {
            remove_icon_if_present(&apps[entry_idx].icon_file);
            Some(copy_icon(&id, src.trim())?)
        }
        _ => apps[entry_idx].icon_file.clone(),
    };

    apps[entry_idx].name = name;
    apps[entry_idx].exe_path = exe_path;
    apps[entry_idx].icon_file = icon_file;
    let updated = apps[entry_idx].clone();

    save_apps(&apps)?;
    Ok(updated)
}

/// Removes an application shortcut and its stored icon copy, if any. For a
/// portable program, also deletes our copy of it under `portable_apps/` —
/// unlike a regular shortcut, that copy isn't a program installed
/// elsewhere, so nothing survives outside KRYPTOS after this.
#[tauri::command]
pub fn delete_application(id: String, db: tauri::State<'_, crate::db::Db>) -> Result<(), String> {
    let mut apps = load_apps()?;
    if let Some(pos) = apps.iter().position(|a| a.id == id) {
        let removed = apps.remove(pos);
        remove_icon_if_present(&removed.icon_file);
        if removed.is_portable {
            if let Ok(dir) = portable_apps_dir() {
                let _ = fs::remove_dir_all(dir.join(&removed.id));
            }
        }
        save_apps(&apps)?;
        crate::commands::audit::record_audit_event(&db, "delete_application", &removed.name, "ok", None);
    }
    Ok(())
}

/// Opens the folder containing an application's executable in the system
/// file manager — mainly useful for a portable program to see what got
/// copied into KRYPTOS's own storage.
#[tauri::command]
pub fn open_application_folder(id: String) -> Result<(), String> {
    let apps = load_apps()?;
    let app = apps.iter().find(|a| a.id == id).ok_or_else(|| "Aplicacion no encontrada.".to_string())?;
    if is_url(&app.exe_path) {
        return Err("Los enlaces web no tienen una carpeta local.".into());
    }
    let exe = Path::new(&app.exe_path);
    let folder = exe.parent().ok_or_else(|| "No se pudo determinar la carpeta.".to_string())?;
    open::that(folder).map_err(|e| format!("No se pudo abrir la carpeta: {e}"))
}

/// Reads a stored icon and returns it as a `data:` URL so the frontend can
/// show it directly in an `<img src>` without needing filesystem or
/// asset-protocol permissions for arbitrary local paths.
#[tauri::command]
pub fn get_app_icon_data_url(icon_file: String) -> Result<String, String> {
    // Only the bare filename is trusted — strips any directory components
    // so this can never be pointed outside the icons directory.
    let safe_name = Path::new(&icon_file)
        .file_name()
        .ok_or_else(|| "Nombre de icono invalido.".to_string())?
        .to_string_lossy()
        .to_string();

    let path = icons_dir()?.join(&safe_name);
    let bytes = fs::read(&path).map_err(|e| format!("No se pudo leer el icono: {e}"))?;

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    };

    Ok(format!("data:{mime};base64,{}", STANDARD.encode(&bytes)))
}

/// Launches the registered executable — the same as double-clicking it.
/// Fire-and-forget: we don't wait for it to exit or capture its output,
/// same as a normal shortcut. If the entry is a `http(s)://` link, opens
/// it with the system's default browser instead of spawning a process.
#[tauri::command]
pub fn launch_application(id: String) -> Result<(), String> {
    let apps = load_apps()?;
    let app = apps.iter().find(|a| a.id == id).ok_or_else(|| "Aplicacion no encontrada.".to_string())?;

    if is_url(&app.exe_path) {
        return open::that(&app.exe_path).map_err(|e| format!("No se pudo abrir el enlace '{}': {e}", app.exe_path));
    }

    let exe = Path::new(&app.exe_path);
    if !exe.exists() {
        return Err(format!("El archivo '{}' ya no existe en esa ruta.", app.exe_path));
    }

    let mut cmd = Command::new(&app.exe_path);
    if let Some(parent) = exe.parent() {
        cmd.current_dir(parent);
    }
    cmd.spawn().map_err(|e| format!("No se pudo abrir '{}': {e}", app.name))?;
    Ok(())
}

// ---------------------------------------------------------------------
// Discover already-installed applications, so adding one to the launcher
// doesn't require manually browsing to its .exe every time.
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct DiscoveredApp {
    pub name: String,
    pub exec_path: String,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinUninstallEntryRaw {
    #[serde(rename = "DisplayName")]
    display_name: Option<String>,
    #[serde(rename = "DisplayIcon")]
    display_icon: Option<String>,
}

#[cfg(target_os = "windows")]
fn parse_discovered_json(raw: &str) -> Vec<WinUninstallEntryRaw> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if let Ok(list) = serde_json::from_str::<Vec<WinUninstallEntryRaw>>(trimmed) {
        return list;
    }
    if let Ok(single) = serde_json::from_str::<WinUninstallEntryRaw>(trimmed) {
        return vec![single];
    }
    vec![]
}

/// Reads the same registry keys Windows' own "Apps & features" list is
/// built from, and keeps only entries whose `DisplayIcon` clearly points
/// at a real, existing `.exe` — better to surface fewer accurate results
/// than a long list where half the entries fail to launch.
#[cfg(target_os = "windows")]
fn list_installed_applications_impl() -> Result<Vec<DiscoveredApp>, String> {
    let script = "$keys = @( \
        'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', \
        'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', \
        'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' \
      ); \
      Get-ItemProperty $keys -ErrorAction SilentlyContinue | \
      Where-Object { $_.DisplayName -and $_.DisplayName.Trim() -ne '' -and -not $_.SystemComponent } | \
      Select-Object DisplayName, DisplayIcon | \
      ConvertTo-Json -Compress";

    let output = crate::commands::run_powershell_utf8(script).map_err(|e| format!("No se pudo ejecutar PowerShell: {e}"))?;
    if !output.status.success() {
        return Err("No se pudo consultar las aplicaciones instaladas.".into());
    }

    let mut seen = std::collections::HashSet::new();
    let mut results = Vec::new();
    for entry in parse_discovered_json(&String::from_utf8_lossy(&output.stdout)) {
        let (Some(name), Some(icon)) = (entry.display_name, entry.display_icon) else { continue };
        // DisplayIcon is commonly "C:\Path\App.exe" or "C:\Path\App.exe,0"
        let exe_part = icon.split(',').next().unwrap_or("").trim();
        if !exe_part.to_lowercase().ends_with(".exe") {
            continue;
        }
        if !Path::new(exe_part).is_file() {
            continue;
        }
        if seen.insert(exe_part.to_lowercase()) {
            results.push(DiscoveredApp { name: name.trim().to_string(), exec_path: exe_part.to_string() });
        }
    }
    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(results)
}

#[cfg(not(target_os = "windows"))]
fn parse_desktop_file(content: &str) -> Option<DiscoveredApp> {
    let mut name = None;
    let mut exec = None;
    let mut no_display = false;
    let mut in_desktop_entry = false;

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_desktop_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_desktop_entry {
            continue;
        }
        if let Some(v) = line.strip_prefix("Name=") {
            if name.is_none() {
                name = Some(v.to_string());
            }
        } else if let Some(v) = line.strip_prefix("Exec=") {
            exec = Some(v.to_string());
        } else if let Some(v) = line.strip_prefix("NoDisplay=") {
            no_display = v.eq_ignore_ascii_case("true");
        }
    }

    if no_display {
        return None;
    }
    let (name, exec) = (name?, exec?);
    // Desktop files use %f/%F/%u/%U as field-code placeholders for files
    // passed to the app — strip them since we're launching with no args.
    let clean_exec: String = exec.split_whitespace().filter(|tok| !tok.starts_with('%')).collect::<Vec<_>>().join(" ");
    if clean_exec.is_empty() {
        return None;
    }
    Some(DiscoveredApp { name, exec_path: clean_exec })
}

#[cfg(not(target_os = "windows"))]
fn list_installed_applications_impl() -> Result<Vec<DiscoveredApp>, String> {
    let mut dirs = vec![PathBuf::from("/usr/share/applications")];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/share/applications"));
    }

    let mut seen = std::collections::HashSet::new();
    let mut results = Vec::new();
    for dir in dirs {
        let Ok(read_dir) = fs::read_dir(&dir) else { continue };
        for entry in read_dir.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("desktop") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                if let Some(app) = parse_desktop_file(&content) {
                    if seen.insert(app.exec_path.clone()) {
                        results.push(app);
                    }
                }
            }
        }
    }
    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(results)
}

/// Lists applications already installed on this machine, so the user can
/// pick one to add to the launcher instead of hunting down its .exe path
/// manually. Windows: reads the same registry list "Apps & features" is
/// built from. Linux: reads the standard freedesktop .desktop files.
#[tauri::command]
pub fn list_installed_applications() -> Result<Vec<DiscoveredApp>, String> {
    list_installed_applications_impl()
}

// ---------------------------------------------------------------------
// Import a portable program (an unzipped folder, or a .zip) so it lives
// inside KRYPTOS's own storage instead of just pointing at wherever the
// user happened to leave it — a USB stick, Downloads, a folder that gets
// cleaned up later, etc. Two-step flow:
//   1. import_portable_source copies/extracts everything into a fresh
//      portable_apps/<id>/ folder and reports every .exe found inside, so
//      the frontend can ask the user which one is the program's main exe.
//   2. finalize_portable_app records the chosen exe as a normal AppEntry.
// If the user cancels partway through, cancel_portable_import removes the
// copy so nothing orphaned is left behind.
// ---------------------------------------------------------------------

fn unique_portable_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("papp-{nanos}")
}

/// Rejects anything that isn't a single bare path component (no `..`, no
/// separators) — every id here was generated by us, so a mismatch means
/// tampering rather than a legitimate identifier.
pub(crate) fn sanitize_id(id: &str) -> Result<String, String> {
    let name = Path::new(id).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if name.is_empty() || name != id {
        return Err("Identificador invalido.".into());
    }
    Ok(name)
}

pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("No se pudo crear '{}': {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("No se pudo leer '{}': {e}", src.display()))? {
        let entry = entry.map_err(|e| format!("Error leyendo el directorio de origen: {e}"))?;
        let file_type = entry.file_type().map_err(|e| format!("Error leyendo '{}': {e}", entry.path().display()))?;
        let dest_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &dest_path).map_err(|e| format!("No se pudo copiar '{}': {e}", entry.path().display()))?;
        }
        // Symlinks are skipped — portable-app folders essentially never use them,
        // and following them could copy something well outside the source folder.
    }
    Ok(())
}

/// Extracts a .zip into `dest`. `enclosed_name()` returns `None` for any
/// entry that would escape `dest` via `..` or an absolute path ("zip slip"),
/// so those entries are silently skipped instead of written outside it.
pub(crate) fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| format!("No se pudo abrir el archivo zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("El archivo zip esta danado o no es valido: {e}"))?;
    fs::create_dir_all(dest).map_err(|e| format!("No se pudo crear '{}': {e}", dest.display()))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Error leyendo el zip: {e}"))?;
        let Some(rel_path) = entry.enclosed_name() else { continue };
        let out_path = dest.join(rel_path);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("No se pudo crear '{}': {e}", out_path.display()))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("No se pudo crear '{}': {e}", parent.display()))?;
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| format!("No se pudo escribir '{}': {e}", out_path.display()))?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| format!("No se pudo extraer '{}': {e}", out_path.display()))?;
        }
    }
    Ok(())
}

/// Recursively lists every `.exe` under `root`, as paths relative to it
/// (forward-slash separated, so the frontend can display/send them without
/// worrying about escaping backslashes).
fn find_exe_candidates(root: &Path) -> Vec<String> {
    let mut results: Vec<String> = WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("exe")))
        .filter_map(|e| e.path().strip_prefix(root).ok().map(|p| p.to_string_lossy().replace('\\', "/")))
        .collect();
    results.sort();
    results
}

fn looks_like_uninstaller_or_setup(file_stem_lower: &str) -> bool {
    file_stem_lower.starts_with("unins") || file_stem_lower.starts_with("uninstall") || file_stem_lower.starts_with("setup")
}

/// Best-effort guess at which discovered `.exe` is the program itself, not
/// an uninstaller/installer/helper — prefers exes at the shallowest folder
/// depth whose name resembles the source folder/zip's name. The user always
/// gets to confirm or override this before it's saved.
fn guess_main_exe(source_name: &str, candidates: &[String]) -> Option<String> {
    let source_lower = source_name.to_lowercase();
    candidates
        .iter()
        .filter(|c| {
            let stem = c.rsplit('/').next().unwrap_or(c).trim_end_matches(".exe").to_lowercase();
            !looks_like_uninstaller_or_setup(&stem)
        })
        .max_by_key(|c| {
            let depth = c.matches('/').count();
            let stem = c.rsplit('/').next().unwrap_or(c).trim_end_matches(".exe").to_lowercase();
            let name_score = if stem == source_lower {
                100
            } else if !source_lower.is_empty() && (source_lower.contains(&stem) || stem.contains(&source_lower)) {
                40
            } else {
                0
            };
            // Shallower wins on ties: depth 0 outranks depth 1, etc.
            name_score - (depth as i32)
        })
        .cloned()
}

#[derive(Serialize)]
pub struct PortableImportResult {
    pub import_id: String,
    pub candidates: Vec<String>,
    pub guessed_exe: Option<String>,
}

/// Step 1 of importing a portable program: copies a folder (or extracts a
/// .zip) into our own `portable_apps/<id>/` storage and reports every .exe
/// found inside. Nothing is added to the launcher yet — call
/// `finalize_portable_app` with the chosen exe to complete it, or
/// `cancel_portable_import` to discard the copy.
#[tauri::command]
pub fn import_portable_source(source_path: String) -> Result<PortableImportResult, String> {
    let source_path = source_path.trim().to_string();
    if source_path.is_empty() {
        return Err("Elige una carpeta de programa portable o un archivo .zip.".into());
    }
    let src = Path::new(&source_path);
    if !src.exists() {
        return Err(format!("No se encontro '{source_path}'."));
    }

    let id = unique_portable_id();
    let dest = portable_apps_dir()?.join(&id);

    let is_zip = src.is_file() && src.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    let import_result = if is_zip {
        extract_zip(src, &dest)
    } else if src.is_dir() {
        copy_dir_recursive(src, &dest)
    } else {
        Err("Elige una carpeta de programa portable o un archivo .zip.".into())
    };

    if let Err(e) = import_result {
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }

    let candidates = find_exe_candidates(&dest);
    if candidates.is_empty() {
        let _ = fs::remove_dir_all(&dest);
        return Err("No se encontro ningun archivo .exe ahi dentro. Revisa que sea la carpeta o el zip correcto del programa portable.".into());
    }

    let source_name = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let guessed_exe = guess_main_exe(&source_name, &candidates);

    Ok(PortableImportResult { import_id: id, candidates, guessed_exe })
}

/// Discards an in-progress import (the user closed the dialog before
/// choosing the main exe, or picked the wrong folder) by deleting the copy
/// `import_portable_source` made.
#[tauri::command]
pub fn cancel_portable_import(import_id: String) -> Result<(), String> {
    let safe_id = sanitize_id(&import_id)?;
    let dir = portable_apps_dir()?.join(safe_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("No se pudo limpiar los archivos temporales: {e}"))?;
    }
    Ok(())
}

/// Step 2: records the chosen exe from a previously-imported portable
/// program as a real launcher entry. `exe_relative_path` must resolve to a
/// file inside that import's own folder — anything else is rejected.
#[tauri::command]
pub fn finalize_portable_app(
    import_id: String,
    name: String,
    exe_relative_path: String,
    icon_source_path: Option<String>,
) -> Result<AppEntry, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Ponle un nombre al programa.".into());
    }

    let safe_id = sanitize_id(&import_id)?;
    let root = portable_apps_dir()?.join(&safe_id);
    if !root.exists() {
        return Err("Esa importacion ya no esta disponible; vuelve a importar la carpeta o el zip.".into());
    }
    let root_canon = fs::canonicalize(&root).map_err(|e| format!("No se pudo resolver la carpeta importada: {e}"))?;

    let candidate = root.join(exe_relative_path.trim().replace('/', std::path::MAIN_SEPARATOR_STR));
    let candidate_canon = fs::canonicalize(&candidate)
        .map_err(|_| "El ejecutable elegido ya no existe dentro de lo importado.".to_string())?;
    if !candidate_canon.starts_with(&root_canon) || !candidate_canon.is_file() {
        return Err("Elige un ejecutable valido dentro de lo importado.".into());
    }

    let icon_file = match icon_source_path {
        Some(src) if !src.trim().is_empty() => Some(copy_icon(&safe_id, src.trim())?),
        _ => None,
    };

    let entry = AppEntry {
        id: safe_id,
        name,
        exe_path: candidate_canon.to_string_lossy().to_string(),
        icon_file,
        added_at_unix: unix_now(),
        is_portable: true,
    };

    let mut apps = load_apps()?;
    apps.push(entry.clone());
    save_apps(&apps)?;
    Ok(entry)
}
