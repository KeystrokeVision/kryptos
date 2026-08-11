//! Mapa de uso de disco y buscador de duplicados para el Explorador —
//! estilo WinDirStat/ncdu, pero navegado carpeta por carpeta en vez de
//! precalcular el arbol entero de una: mucho mas barato, y el usuario ya
//! esta acostumbrado a navegar asi en el resto del Explorador.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::Serialize;
use walkdir::WalkDir;

use crate::commands::security::hash_file_bytes;

// Mismo espiritu que MAX_FILES_PER_SCAN en security.rs: esto sigue siendo
// una GUI interactiva, no un batch job — un escaneo de C:\ completo no
// deberia colgar la app, mejor cortar y avisar que quedo incompleto.
const MAX_FILES_PER_SIZE_SCAN: usize = 100_000;
const MAX_FILES_PER_DUP_SCAN: usize = 50_000;

#[derive(Serialize)]
pub struct DirSizeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub truncated: bool,
}

fn dir_size(path: &Path, budget: &mut usize) -> (u64, bool) {
    let mut total = 0u64;
    let mut truncated = false;
    for entry in WalkDir::new(path).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        if *budget == 0 {
            truncated = true;
            break;
        }
        *budget -= 1;
        if let Ok(metadata) = entry.metadata() {
            total += metadata.len();
        }
    }
    (total, truncated)
}

/// Tamaño de cada hijo directo de `path` — archivos tal cual, carpetas
/// sumadas recursivamente. Pensado para que el frontend arme una vista tipo
/// "barra proporcional al tamaño" y deje hacer click para entrar a la
/// siguiente carpeta, en vez de precalcular todo el disco de una.
#[tauri::command]
pub fn get_directory_sizes(path: String) -> Result<Vec<DirSizeEntry>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("'{path}' no es una carpeta."));
    }

    let mut budget = MAX_FILES_PER_SIZE_SCAN;
    let mut entries = Vec::new();

    let children = fs::read_dir(root).map_err(|e| format!("No se pudo leer la carpeta: {e}"))?;
    for child in children.filter_map(|c| c.ok()) {
        let child_path = child.path();
        let Ok(metadata) = child.metadata() else { continue };
        let name = child.file_name().to_string_lossy().to_string();

        if metadata.is_dir() {
            if budget == 0 {
                entries.push(DirSizeEntry { name, path: child_path.display().to_string(), is_dir: true, size_bytes: 0, truncated: true });
                continue;
            }
            let (size, truncated) = dir_size(&child_path, &mut budget);
            entries.push(DirSizeEntry { name, path: child_path.display().to_string(), is_dir: true, size_bytes: size, truncated });
        } else {
            entries.push(DirSizeEntry { name, path: child_path.display().to_string(), is_dir: false, size_bytes: metadata.len(), truncated: false });
        }
    }

    entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Ok(entries)
}

#[derive(Serialize)]
pub struct DuplicateGroup {
    pub sha256: String,
    pub size_bytes: u64,
    pub paths: Vec<String>,
}

#[derive(Serialize)]
pub struct DuplicateScanResult {
    pub groups: Vec<DuplicateGroup>,
    pub files_scanned: usize,
    pub truncated: bool,
}

/// Busca duplicados exactos bajo `path`: primero agrupa por tamaño (barato),
/// y solo hashea archivos que comparten tamaño con al menos otro — el mismo
/// truco que usa cualquier buscador de duplicados real para no tener que
/// hashear todo el disco entero.
#[tauri::command]
pub fn find_duplicate_files(path: String) -> Result<DuplicateScanResult, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("'{path}' no es una carpeta."));
    }

    let mut by_size: HashMap<u64, Vec<std::path::PathBuf>> = HashMap::new();
    let mut files_scanned = 0usize;
    let mut truncated = false;

    for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        if files_scanned >= MAX_FILES_PER_DUP_SCAN {
            truncated = true;
            break;
        }
        files_scanned += 1;
        if let Ok(metadata) = entry.metadata() {
            if metadata.len() == 0 {
                continue; // los archivos vacios "coinciden" entre si sin decir nada util
            }
            by_size.entry(metadata.len()).or_default().push(entry.path().to_path_buf());
        }
    }

    let mut by_hash: HashMap<String, (u64, Vec<String>)> = HashMap::new();
    for (size, paths) in by_size.into_iter().filter(|(_, p)| p.len() > 1) {
        for path in paths {
            if let Ok((sha256, _, _)) = hash_file_bytes(&path) {
                let entry = by_hash.entry(sha256).or_insert((size, Vec::new()));
                entry.1.push(path.display().to_string());
            }
        }
    }

    let mut groups: Vec<DuplicateGroup> = by_hash
        .into_iter()
        .filter(|(_, (_, paths))| paths.len() > 1)
        .map(|(sha256, (size_bytes, paths))| DuplicateGroup { sha256, size_bytes, paths })
        .collect();
    groups.sort_by(|a, b| (b.size_bytes * b.paths.len() as u64).cmp(&(a.size_bytes * a.paths.len() as u64)));

    Ok(DuplicateScanResult { groups, files_scanned, truncated })
}
