use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::db::Db;

#[derive(Serialize)]
pub struct SettingEntry {
    pub key: String,
    pub value: String,
}

/// Reads a single setting by key. Returns `None` if it was never set —
/// callers apply their own default rather than the backend guessing one.
#[tauri::command]
pub fn get_setting(db: State<'_, Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la configuracion.".to_string())?;
    conn.query_row("SELECT value FROM app_settings WHERE key = ?1", params![key], |row| row.get(0))
        .optional()
        .map_err(|e| format!("No se pudo leer la configuracion: {e}"))
}

/// Sets (or updates) a single setting.
#[tauri::command]
pub fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la configuracion.".to_string())?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| format!("No se pudo guardar la configuracion: {e}"))?;
    Ok(())
}

/// Returns every stored setting — used by the Settings page to hydrate its
/// form in one call instead of one `get_setting` per field.
#[tauri::command]
pub fn get_all_settings(db: State<'_, Db>) -> Result<Vec<SettingEntry>, String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la configuracion.".to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_settings ORDER BY key")
        .map_err(|e| format!("No se pudo consultar la configuracion: {e}"))?;
    let rows = stmt
        .query_map([], |row| Ok(SettingEntry { key: row.get(0)?, value: row.get(1)? }))
        .map_err(|e| format!("No se pudo leer la configuracion: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer una fila de configuracion: {e}"))
}

/// The folder KRYPTOS stores its local data in (SQLite database, security
/// baselines, app icons) — shown in Settings so the user knows where it
/// lives, since none of this syncs anywhere.
#[tauri::command]
pub fn get_data_directory() -> Result<String, String> {
    let base = dirs::config_dir().ok_or_else(|| "No se pudo determinar el directorio de configuracion del sistema.".to_string())?;
    Ok(base.join("kryptos").display().to_string())
}

/// Opens a path in the OS's native file manager (Explorer/Finder/whatever
/// the Linux DE provides) — used by the "Abrir carpeta" button next to the
/// data directory.
#[tauri::command]
pub fn open_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&path).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&path).spawn();

    result.map(|_| ()).map_err(|e| format!("No se pudo abrir el gestor de archivos: {e}"))
}
