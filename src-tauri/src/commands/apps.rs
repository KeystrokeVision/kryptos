use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

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
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn unique_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("app-{nanos}")
}

fn apps_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "No se pudo determinar el directorio de configuracion del sistema.".to_string())?;
    let dir = base.join("kryptos");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de configuracion: {e}"))?;
    Ok(dir)
}

fn icons_dir() -> Result<PathBuf, String> {
    let dir = apps_dir()?.join("app_icons");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de iconos: {e}"))?;
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

    let entry = AppEntry { id, name, exe_path, icon_file, added_at_unix: unix_now() };

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

/// Removes an application shortcut and its stored icon copy, if any.
#[tauri::command]
pub fn delete_application(id: String, db: tauri::State<'_, crate::db::Db>) -> Result<(), String> {
    let mut apps = load_apps()?;
    if let Some(pos) = apps.iter().position(|a| a.id == id) {
        let removed = apps.remove(pos);
        remove_icon_if_present(&removed.icon_file);
        save_apps(&apps)?;
        crate::commands::audit::record_audit_event(&db, "delete_application", &removed.name, "ok", None);
    }
    Ok(())
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
