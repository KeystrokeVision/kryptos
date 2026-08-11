use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::params;
use serde::Serialize;
use sysinfo::Disks;
use tauri::State;

use crate::db::Db;

// ---------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size_bytes: u64,
    pub modified_unix: u64,
    pub is_hidden: bool,
}

#[cfg(target_os = "windows")]
fn is_hidden_attr(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}
#[cfg(not(target_os = "windows"))]
fn is_hidden_attr(_meta: &fs::Metadata) -> bool {
    false
}

fn modified_unix_of(meta: &fs::Metadata) -> u64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

/// Lists the immediate contents of a directory — folders first, then files,
/// both alphabetical (case-insensitive). Unreadable entries (permissions,
/// broken symlinks) are skipped rather than failing the whole listing.
#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let dir = Path::new(&path);
    if !dir.exists() {
        return Err(format!("La ruta '{path}' no existe."));
    }
    if !dir.is_dir() {
        return Err(format!("'{path}' no es una carpeta."));
    }

    let read_dir = fs::read_dir(dir).map_err(|e| format!("No se pudo leer la carpeta: {e}"))?;
    let mut entries = Vec::new();
    for entry in read_dir.filter_map(|e| e.ok()) {
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        entries.push(DirEntryInfo {
            is_hidden: name.starts_with('.') || is_hidden_attr(&meta),
            name,
            path: entry.path().display().to_string(),
            is_dir: meta.is_dir(),
            is_symlink: meta.file_type().is_symlink(),
            size_bytes: if meta.is_dir() { 0 } else { meta.len() },
            modified_unix: modified_unix_of(&meta),
        });
    }

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

/// The user's home directory — the Explorer's default starting point.
#[tauri::command]
pub fn get_home_directory() -> String {
    dirs::home_dir().map(|p| p.display().to_string()).unwrap_or_else(|| ".".to_string())
}

// ---------------------------------------------------------------------
// Drives / quick access
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct DriveInfo {
    pub path: String,
    pub label: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub removable: bool,
}

/// Lists mounted volumes (drive letters on Windows, mount points on
/// Unix) with capacity, so the Explorer sidebar can show real quick-access
/// entries instead of a hardcoded "C:\".
#[tauri::command]
pub fn list_drives() -> Vec<DriveInfo> {
    Disks::new_with_refreshed_list()
        .iter()
        .map(|disk| {
            let mount = disk.mount_point().display().to_string();
            let name = disk.name().to_string_lossy().to_string();
            DriveInfo {
                path: mount.clone(),
                label: if name.trim().is_empty() { mount } else { name },
                total_bytes: disk.total_space(),
                available_bytes: disk.available_space(),
                removable: disk.is_removable(),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------
// Create / rename / delete
// ---------------------------------------------------------------------

fn validate_entry_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("El nombre no puede estar vacio.".into());
    }
    const FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if name.chars().any(|c| FORBIDDEN.contains(&c)) {
        return Err(r#"El nombre no puede contener: / \ : * ? " < > |"#.into());
    }
    Ok(())
}

#[tauri::command]
pub fn create_directory(parent_path: String, name: String) -> Result<String, String> {
    validate_entry_name(&name)?;
    let target = Path::new(&parent_path).join(name.trim());
    if target.exists() {
        return Err("Ya existe un elemento con ese nombre.".into());
    }
    fs::create_dir(&target).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn create_empty_file(parent_path: String, name: String) -> Result<String, String> {
    validate_entry_name(&name)?;
    let target = Path::new(&parent_path).join(name.trim());
    if target.exists() {
        return Err("Ya existe un elemento con ese nombre.".into());
    }
    fs::write(&target, []).map_err(|e| format!("No se pudo crear el archivo: {e}"))?;
    Ok(target.display().to_string())
}

#[tauri::command]
pub fn rename_path(path: String, new_name: String) -> Result<String, String> {
    validate_entry_name(&new_name)?;
    let src = Path::new(&path);
    let Some(parent) = src.parent() else {
        return Err("No se puede renombrar esta ruta.".into());
    };
    let dest = parent.join(new_name.trim());
    if dest.exists() {
        return Err("Ya existe un elemento con ese nombre.".into());
    }
    fs::rename(src, &dest).map_err(|e| format!("No se pudo renombrar: {e}"))?;
    Ok(dest.display().to_string())
}

/// Permanently deletes a file or folder (recursively). The frontend must
/// confirm with the user before calling this — same convention as
/// `kill_process` and `delete_baseline`. There is no recycle-bin/trash
/// integration yet, so this is documented as irreversible in the UI.
#[tauri::command]
pub fn delete_path(path: String, db: State<'_, Db>) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("'{path}' ya no existe."));
    }
    let is_dir = target.is_dir();
    let result = if is_dir { fs::remove_dir_all(target) } else { fs::remove_file(target) };

    match result {
        Ok(()) => {
            crate::commands::audit::record_audit_event(
                &db,
                "delete_path",
                &path,
                "ok",
                Some(if is_dir { "carpeta" } else { "archivo" }),
            );
            Ok(())
        }
        Err(e) => {
            let msg = format!("No se pudo eliminar '{path}': {e}");
            crate::commands::audit::record_audit_event(&db, "delete_path", &path, "error", Some(&msg));
            Err(msg)
        }
    }
}

// ---------------------------------------------------------------------
// Move / copy
// ---------------------------------------------------------------------

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

fn dest_for(src: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    let name = src.file_name().ok_or_else(|| "Ruta de origen invalida.".to_string())?;
    let dest = dest_dir.join(name);
    if dest.exists() {
        return Err(format!("Ya existe '{}' en el destino.", dest.display()));
    }
    Ok(dest)
}

/// Copies a file or folder into `dest_dir`, keeping the original name.
/// Fails rather than overwriting if something with that name already
/// exists at the destination.
#[tauri::command]
pub fn copy_path(source_path: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&source_path);
    if !src.exists() {
        return Err(format!("'{source_path}' no existe."));
    }
    let dest = dest_for(src, Path::new(&dest_dir))?;

    if src.is_dir() {
        copy_dir_recursive(src, &dest).map_err(|e| format!("No se pudo copiar la carpeta: {e}"))?;
    } else {
        fs::copy(src, &dest).map_err(|e| format!("No se pudo copiar el archivo: {e}"))?;
    }
    Ok(dest.display().to_string())
}

/// Moves a file or folder into `dest_dir`. Tries the fast, atomic
/// `rename` first (works when source and destination are on the same
/// volume); falls back to copy-then-delete for cross-volume moves, which
/// `rename` can't do on either Windows or Unix.
#[tauri::command]
pub fn move_path(source_path: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&source_path);
    if !src.exists() {
        return Err(format!("'{source_path}' no existe."));
    }
    let dest = dest_for(src, Path::new(&dest_dir))?;

    if fs::rename(src, &dest).is_ok() {
        return Ok(dest.display().to_string());
    }

    // Cross-volume fallback.
    if src.is_dir() {
        copy_dir_recursive(src, &dest).map_err(|e| format!("No se pudo mover la carpeta: {e}"))?;
        fs::remove_dir_all(src).map_err(|e| format!("Se copio pero no se pudo borrar el origen: {e}"))?;
    } else {
        fs::copy(src, &dest).map_err(|e| format!("No se pudo mover el archivo: {e}"))?;
        fs::remove_file(src).map_err(|e| format!("Se copio pero no se pudo borrar el origen: {e}"))?;
    }
    Ok(dest.display().to_string())
}

// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------

const MAX_SEARCH_RESULTS: usize = 500;
const MAX_SEARCH_DEPTH: usize = 12;

fn search_dir(dir: &Path, query: &str, depth: usize, out: &mut Vec<DirEntryInfo>) {
    if out.len() >= MAX_SEARCH_RESULTS || depth > MAX_SEARCH_DEPTH {
        return;
    }
    let Ok(read_dir) = fs::read_dir(dir) else { return };
    for entry in read_dir.filter_map(|e| e.ok()) {
        if out.len() >= MAX_SEARCH_RESULTS {
            return;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.to_lowercase().contains(query) {
            out.push(DirEntryInfo {
                is_hidden: name.starts_with('.') || is_hidden_attr(&meta),
                name: name.clone(),
                path: entry.path().display().to_string(),
                is_dir: meta.is_dir(),
                is_symlink: meta.file_type().is_symlink(),
                size_bytes: if meta.is_dir() { 0 } else { meta.len() },
                modified_unix: modified_unix_of(&meta),
            });
        }
        if meta.is_dir() && !meta.file_type().is_symlink() {
            search_dir(&entry.path(), query, depth + 1, out);
        }
    }
}

/// Recursively searches under `root` for entries whose name contains
/// `query` (case-insensitive). Capped in both result count and depth so a
/// search from a large root doesn't hang the UI.
#[tauri::command]
pub fn search_directory(root: String, query: String) -> Result<Vec<DirEntryInfo>, String> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Err("Escribe algo para buscar.".into());
    }
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("'{root}' no es una carpeta valida."));
    }
    let mut out = Vec::new();
    search_dir(root_path, &query, 0, &mut out);
    Ok(out)
}

// ---------------------------------------------------------------------
// Favorites (SQLite)
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct FavoriteEntry {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub added_at_unix: i64,
}

#[tauri::command]
pub fn list_favorites(db: State<'_, Db>) -> Result<Vec<FavoriteEntry>, String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a los favoritos.".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, path, label, added_at_unix FROM explorer_favorites ORDER BY label COLLATE NOCASE ASC")
        .map_err(|e| format!("No se pudo consultar los favoritos: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(FavoriteEntry { id: row.get(0)?, path: row.get(1)?, label: row.get(2)?, added_at_unix: row.get(3)? })
        })
        .map_err(|e| format!("No se pudo leer los favoritos: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer un favorito: {e}"))
}

#[tauri::command]
pub fn add_favorite(db: State<'_, Db>, path: String, label: String) -> Result<(), String> {
    let label = if label.trim().is_empty() {
        Path::new(&path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone())
    } else {
        label.trim().to_string()
    };
    let added_at_unix = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a los favoritos.".to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO explorer_favorites (path, label, added_at_unix) VALUES (?1, ?2, ?3)",
        params![path, label, added_at_unix],
    )
    .map_err(|e| format!("No se pudo agregar el favorito: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn remove_favorite(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a los favoritos.".to_string())?;
    conn.execute("DELETE FROM explorer_favorites WHERE id = ?1", params![id])
        .map_err(|e| format!("No se pudo quitar el favorito: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------
// Lectura/escritura de texto (para el Editor)
// ---------------------------------------------------------------------

/// Hard cap so the Editor never tries to load something enormous (a log
/// file, a database dump) into a text buffer and freeze the UI.
const MAX_EDITABLE_FILE_BYTES: u64 = 10 * 1024 * 1024; // 10 MB

/// Reads a file as UTF-8 text for the Editor module. Reuses the same
/// filesystem access the Explorer already has — no new permission surface.
#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let metadata = fs::metadata(p).map_err(|e| format!("No se pudo leer '{path}': {e}"))?;
    if metadata.len() > MAX_EDITABLE_FILE_BYTES {
        return Err(format!(
            "El archivo pesa {:.1} MB — mas del limite de 10 MB para editar en KRYPTOS.",
            metadata.len() as f64 / (1024.0 * 1024.0)
        ));
    }
    fs::read_to_string(p).map_err(|e| format!("No se pudo leer '{path}' como texto (¿es un archivo binario?): {e}"))
}

/// Writes text content back to a file, overwriting it. The frontend is
/// responsible for warning about unsaved-changes loss before calling this
/// on close/switch — the write itself is unconditional, same as any editor's "Save".
#[tauri::command]
pub fn write_file_text(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| format!("No se pudo guardar '{path}': {e}"))
}
