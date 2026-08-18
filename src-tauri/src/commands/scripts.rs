use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::State;
use walkdir::WalkDir;

use crate::commands::apps::{copy_dir_recursive, extract_zip, sanitize_id};
use crate::commands::audit::record_audit_event;
use crate::db::Db;

#[derive(Serialize)]
pub struct CommandOutput {
    pub success: bool,
    pub output: String,
}

const ALLOWED_ICON_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"];

fn python_binary() -> &'static str {
    if cfg!(target_os = "windows") {
        "python"
    } else {
        "python3"
    }
}

/// Looks for a virtual environment (`.venv` or `venv`) next to the script
/// and returns the path to its Python interpreter if one exists — so
/// "Ejecutar" uses the project's own dependencies instead of whatever
/// Python happens to be on the system PATH, the same thing an IDE's "Run"
/// button does.
fn venv_python(script_dir: &Path) -> Option<std::path::PathBuf> {
    for venv_name in [".venv", "venv"] {
        let venv_dir = script_dir.join(venv_name);
        #[cfg(target_os = "windows")]
        let candidate = venv_dir.join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let candidate = venv_dir.join("bin").join("python");

        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Maps a file extension to the interpreter + args needed to run it. Only
/// a fixed, known set of script types — this isn't a generic "run any
/// program" command, it's specifically "run the file open in the editor".
fn interpreter_for(path: &Path) -> Result<(String, Vec<String>), String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let path_str = path.display().to_string();
    let script_dir = path.parent();

    match ext.as_str() {
        "ps1" => Ok(("powershell".to_string(), vec!["-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), path_str])),
        "sh" | "bash" => Ok(("bash".to_string(), vec![path_str])),
        "py" => {
            let program = script_dir
                .and_then(venv_python)
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| python_binary().to_string());
            Ok((program, vec![path_str]))
        }
        "bat" | "cmd" => Ok(("cmd".to_string(), vec!["/C".into(), path_str])),
        "js" | "mjs" => Ok(("node".to_string(), vec![path_str])),
        other => Err(format!(
            "No se reconoce '.{other}' como un script ejecutable. Soportados: .ps1, .sh/.bash, .py, .bat/.cmd, .js"
        )),
    }
}

/// Actually spawns the interpreter for `path` and waits for it to exit,
/// with its working directory set to the script's own folder — the same
/// convention an IDE's "Run" button uses, so relative paths and local
/// `node_modules` resolve correctly. This blocks until the script exits —
/// a script that waits for interactive input or runs forever will hang the
/// call, same characteristic as the existing quick-tools commands (ping,
/// nmap). Shared by `run_script` (the editor's "run this open file" button)
/// and `run_saved_script` (the Scripts library) so both audit identically.
fn execute_script_file(path: &str) -> Result<CommandOutput, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("El archivo '{path}' no existe. Guardalo antes de ejecutarlo."));
    }
    let (program, args) = interpreter_for(p)?;

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let mut cmd = Command::new(&program);
    cmd.args(&arg_refs);
    if let Some(dir) = p.parent() {
        cmd.current_dir(dir);
    }

    match cmd.output() {
        Ok(out) => {
            let mut text = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.trim().is_empty() {
                text.push('\n');
                text.push_str(&stderr);
            }
            Ok(CommandOutput { success: out.status.success(), output: text })
        }
        Err(e) => Err(format!("No se pudo ejecutar '{program}': {e}. ¿Esta instalado y en el PATH?")),
    }
}

/// Runs the file currently open in the Editor.
#[tauri::command]
pub fn run_script(path: String, db: State<'_, Db>) -> Result<CommandOutput, String> {
    match execute_script_file(&path) {
        Ok(result) => {
            record_audit_event(&db, "run_script", &path, if result.success { "ok" } else { "error" }, None);
            Ok(result)
        }
        Err(msg) => {
            record_audit_event(&db, "run_script", &path, "error", Some(&msg));
            Err(msg)
        }
    }
}

// ---------------------------------------------------------------------
// Scripts library — a showcase of your own scripts, not a remote-execution
// surface: each entry is our own copy of a script (or a whole bundle of
// files) plus an optional icon and a link to its source repository, kept
// inside KRYPTOS's portable data root (see commands::portable_data_root)
// so — like the Aplicaciones launcher's portable programs — it travels
// with the app instead of pointing at wherever the original file happened
// to live. Whoever KRYPTOS is shared with can open the folder and read the
// code, or follow the repo link, but nothing here runs it for them. Same
// two-step import flow as apps::import_portable_source /
// apps::finalize_portable_app, just for scripts instead of .exe's:
//   1. import_script_source copies a single file, a whole folder, or
//      extracts a .zip into a fresh scripts/imports/<id>/ folder and
//      reports every recognized script found inside (a bundle can have
//      more than one — e.g. a Python script alongside a helper module).
//   2. finalize_script_import moves that folder into permanent storage
//      (scripts/files/<id>/) and records the chosen entry file as a
//      ScriptEntry. The whole folder is kept, not just the chosen file, so
//      anything it references (a module, a requirements list, a config)
//      stays right next to it when someone opens the folder to look.
// cancel_script_import discards an in-progress import if the user backs
// out before finalizing.
// ---------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct ScriptEntry {
    pub id: String,
    pub name: String,
    /// Absolute path to the entry file inside our own copy of the bundle
    /// (`scripts/files/<id>/...`).
    pub script_path: String,
    pub icon_file: Option<String>,
    /// Optional link to where this script actually lives/is maintained
    /// (a GitHub repo, a Gist, ...). Purely informational — KRYPTOS never
    /// fetches it.
    #[serde(default)]
    pub repo_url: Option<String>,
    pub added_at_unix: u64,
}

fn normalize_repo_url(repo_url: Option<String>) -> Result<Option<String>, String> {
    match repo_url.map(|s| s.trim().to_string()) {
        Some(s) if s.is_empty() => Ok(None),
        Some(s) if s.starts_with("http://") || s.starts_with("https://") => Ok(Some(s)),
        Some(_) => Err("El link del repositorio debe empezar con http:// o https://.".into()),
        None => Ok(None),
    }
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn unique_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("script-{nanos}")
}

fn scripts_dir() -> Result<PathBuf, String> {
    let dir = crate::commands::portable_data_root()?.join("scripts");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de scripts: {e}"))?;
    Ok(dir)
}

fn script_files_dir() -> Result<PathBuf, String> {
    let dir = scripts_dir()?.join("files");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de archivos de script: {e}"))?;
    Ok(dir)
}

/// Scratch space for an import in progress — cleared out once
/// `finalize_script_import` moves it into `scripts/files/` or
/// `cancel_script_import` discards it.
fn imports_dir() -> Result<PathBuf, String> {
    let dir = scripts_dir()?.join("imports");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio temporal de importacion: {e}"))?;
    Ok(dir)
}

fn script_icons_dir() -> Result<PathBuf, String> {
    let dir = scripts_dir()?.join("icons");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de iconos: {e}"))?;
    Ok(dir)
}

fn scripts_file() -> Result<PathBuf, String> {
    Ok(scripts_dir()?.join("scripts.json"))
}

fn load_scripts() -> Result<Vec<ScriptEntry>, String> {
    let path = scripts_file()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("No se pudo leer la lista de scripts: {e}"))?;
    if content.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&content).map_err(|e| format!("La lista de scripts esta corrupta: {e}"))
}

fn save_scripts(scripts: &[ScriptEntry]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(scripts).map_err(|e| format!("No se pudo preparar la lista de scripts: {e}"))?;
    fs::write(scripts_file()?, json).map_err(|e| format!("No se pudo guardar la lista de scripts: {e}"))
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
    let dest = script_icons_dir()?.join(format!("{id}.{ext}"));
    fs::copy(src, &dest).map_err(|e| format!("No se pudo copiar la imagen: {e}"))?;
    Ok(dest.file_name().unwrap().to_string_lossy().to_string())
}

fn remove_icon_if_present(icon_file: &Option<String>) {
    if let (Some(file), Ok(dir)) = (icon_file, script_icons_dir()) {
        let _ = fs::remove_file(dir.join(file));
    }
}

/// Recursively lists every file under `root` that `interpreter_for`
/// recognizes as runnable, as paths relative to `root` (forward-slash
/// separated). Reuses `interpreter_for` itself as the single source of
/// truth for "what counts as a script" instead of a second, easy-to-drift
/// extension list.
fn find_script_candidates(root: &Path) -> Vec<String> {
    let mut results: Vec<String> = WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| interpreter_for(e.path()).is_ok())
        .filter_map(|e| e.path().strip_prefix(root).ok().map(|p| p.to_string_lossy().replace('\\', "/")))
        .collect();
    results.sort();
    results
}

const ENTRYPOINT_NAMES: &[&str] = &["main", "run", "start", "index", "app"];

/// Best-effort guess at which discovered script is the one to run —
/// prefers a name matching the source folder/zip, then common entrypoint
/// names (main/run/start/index/app), then shallower folder depth on ties.
/// The user always gets to confirm or override this before it's saved.
fn guess_main_script(source_name: &str, candidates: &[String]) -> Option<String> {
    let source_lower = source_name.to_lowercase();
    candidates
        .iter()
        .max_by_key(|c| {
            let depth = c.matches('/').count();
            let stem = Path::new(c.as_str()).file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
            let name_score = if stem == source_lower {
                100
            } else if ENTRYPOINT_NAMES.contains(&stem.as_str()) {
                60
            } else if !source_lower.is_empty() && (source_lower.contains(&stem) || stem.contains(&source_lower)) {
                40
            } else {
                0
            };
            name_score - depth as i32
        })
        .cloned()
}

#[derive(Serialize)]
pub struct ScriptImportResult {
    pub import_id: String,
    pub candidates: Vec<String>,
    pub guessed_script: Option<String>,
}

/// Lists every script saved in the library.
#[tauri::command]
pub fn list_scripts() -> Result<Vec<ScriptEntry>, String> {
    load_scripts()
}

/// Step 1 of adding a script: copies a single file, a whole folder, or
/// extracts a .zip into our own `scripts/imports/<id>/` scratch space and
/// reports every runnable script found inside. Nothing is added to the
/// library yet — call `finalize_script_import` with the chosen entry file
/// to complete it, or `cancel_script_import` to discard the copy.
#[tauri::command]
pub fn import_script_source(source_path: String) -> Result<ScriptImportResult, String> {
    let source_path = source_path.trim().to_string();
    if source_path.is_empty() {
        return Err("Elige un archivo, una carpeta o un .zip de scripts.".into());
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
    } else if src.is_file() {
        fs::create_dir_all(&dest)
            .map_err(|e| format!("No se pudo crear '{}': {e}", dest.display()))
            .and_then(|_| {
                let file_name = src.file_name().ok_or_else(|| "Nombre de archivo invalido.".to_string())?;
                fs::copy(src, dest.join(file_name)).map(|_| ()).map_err(|e| format!("No se pudo copiar '{source_path}': {e}"))
            })
    } else {
        Err("Elige un archivo, una carpeta o un .zip de scripts.".into())
    };

    if let Err(e) = import_result {
        let _ = fs::remove_dir_all(&dest);
        return Err(e);
    }

    let candidates = find_script_candidates(&dest);
    if candidates.is_empty() {
        let _ = fs::remove_dir_all(&dest);
        return Err("No se encontro ningun script reconocido ahi dentro. Soportados: .ps1, .sh/.bash, .py, .bat/.cmd, .js.".into());
    }

    let source_name = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let guessed_script = guess_main_script(&source_name, &candidates);

    Ok(ScriptImportResult { import_id: id, candidates, guessed_script })
}

/// Discards an in-progress import (the user closed the dialog before
/// choosing the entry script, or picked the wrong thing) by deleting the
/// scratch copy `import_script_source` made.
#[tauri::command]
pub fn cancel_script_import(import_id: String) -> Result<(), String> {
    let safe_id = sanitize_id(&import_id)?;
    let dir = imports_dir()?.join(safe_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("No se pudo limpiar los archivos temporales: {e}"))?;
    }
    Ok(())
}

/// Step 2: moves a previously-imported bundle into permanent storage and
/// records the chosen file as a real library entry, with an optional icon.
#[tauri::command]
pub fn finalize_script_import(
    import_id: String,
    name: String,
    script_relative_path: String,
    repo_url: Option<String>,
    icon_source_path: Option<String>,
) -> Result<ScriptEntry, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Ponle un nombre al script.".into());
    }
    let repo_url = normalize_repo_url(repo_url)?;

    let safe_id = sanitize_id(&import_id)?;
    let import_root = imports_dir()?.join(&safe_id);
    if !import_root.exists() {
        return Err("Esa importacion ya no esta disponible; vuelve a importarla.".into());
    }
    let import_root_canon = fs::canonicalize(&import_root).map_err(|e| format!("No se pudo resolver lo importado: {e}"))?;

    let candidate = import_root.join(script_relative_path.trim().replace('/', std::path::MAIN_SEPARATOR_STR));
    let candidate_canon =
        fs::canonicalize(&candidate).map_err(|_| "El script elegido ya no existe dentro de lo importado.".to_string())?;
    if !candidate_canon.starts_with(&import_root_canon) || !candidate_canon.is_file() {
        return Err("Elige un script valido dentro de lo importado.".into());
    }
    // Extension must still be one interpreter_for knows how to run before
    // this becomes a permanent, otherwise-unrunnable entry.
    interpreter_for(&candidate_canon)?;
    let relative_to_entry = candidate_canon
        .strip_prefix(&import_root_canon)
        .map_err(|_| "Ruta de script invalida.".to_string())?
        .to_path_buf();

    let permanent_dir = script_files_dir()?.join(&safe_id);
    if permanent_dir.exists() {
        let _ = fs::remove_dir_all(&permanent_dir);
    }
    // rename() is an atomic move when both paths share a volume (true here,
    // both live under the same portable data root) — falls back to
    // copy+delete only if that ever isn't the case.
    if fs::rename(&import_root, &permanent_dir).is_err() {
        copy_dir_recursive(&import_root, &permanent_dir)?;
        let _ = fs::remove_dir_all(&import_root);
    }

    let script_path = permanent_dir.join(&relative_to_entry);

    let icon_file = match icon_source_path {
        Some(src) if !src.trim().is_empty() => Some(copy_icon(&safe_id, src.trim())?),
        _ => None,
    };

    let entry = ScriptEntry {
        id: safe_id,
        name,
        script_path: script_path.to_string_lossy().to_string(),
        icon_file,
        repo_url,
        added_at_unix: unix_now(),
    };

    let mut scripts = load_scripts()?;
    scripts.push(entry.clone());
    save_scripts(&scripts)?;
    Ok(entry)
}

/// Renames a script, replaces its icon, and/or updates its repository
/// link (pass `None`/empty to clear the link — unlike the icon, there's no
/// expensive copy behind it, so it just takes whatever the form currently
/// holds). To change the script's actual content, delete it and import the
/// new version — the same "delete and re-add" convention
/// `apps::update_application` uses for removing an icon entirely.
#[tauri::command]
pub fn update_script(
    id: String,
    name: String,
    repo_url: Option<String>,
    icon_source_path: Option<String>,
) -> Result<ScriptEntry, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Ponle un nombre al script.".into());
    }
    let repo_url = normalize_repo_url(repo_url)?;

    let mut scripts = load_scripts()?;
    let idx = scripts.iter().position(|s| s.id == id).ok_or_else(|| "Script no encontrado.".to_string())?;

    let icon_file = match icon_source_path {
        Some(src) if !src.trim().is_empty() => {
            remove_icon_if_present(&scripts[idx].icon_file);
            Some(copy_icon(&id, src.trim())?)
        }
        _ => scripts[idx].icon_file.clone(),
    };

    scripts[idx].name = name;
    scripts[idx].icon_file = icon_file;
    scripts[idx].repo_url = repo_url;
    let updated = scripts[idx].clone();

    save_scripts(&scripts)?;
    Ok(updated)
}

/// Removes a script from the library, along with our whole copy of its
/// bundle folder and icon.
#[tauri::command]
pub fn delete_script(id: String, db: State<'_, Db>) -> Result<(), String> {
    let mut scripts = load_scripts()?;
    if let Some(pos) = scripts.iter().position(|s| s.id == id) {
        let removed = scripts.remove(pos);
        if let Ok(dir) = script_files_dir() {
            let _ = fs::remove_dir_all(dir.join(&removed.id));
        }
        remove_icon_if_present(&removed.icon_file);
        save_scripts(&scripts)?;
        record_audit_event(&db, "delete_script", &removed.name, "ok", None);
    }
    Ok(())
}

/// Reads a stored script icon and returns it as a `data:` URL, same
/// approach as `apps::get_app_icon_data_url` and for the same reason: the
/// frontend never needs filesystem access to arbitrary local paths.
#[tauri::command]
pub fn get_script_icon_data_url(icon_file: String) -> Result<String, String> {
    let safe_name = Path::new(&icon_file)
        .file_name()
        .ok_or_else(|| "Nombre de icono invalido.".to_string())?
        .to_string_lossy()
        .to_string();

    let path = script_icons_dir()?.join(&safe_name);
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

/// Opens the folder holding a saved script's files in the system file
/// manager, so whoever's looking (you, or someone you shared KRYPTOS with)
/// can read the code itself instead of KRYPTOS running it for them.
#[tauri::command]
pub fn open_script_folder(id: String) -> Result<(), String> {
    let scripts = load_scripts()?;
    let entry = scripts.iter().find(|s| s.id == id).ok_or_else(|| "Script no encontrado.".to_string())?;
    let folder = Path::new(&entry.script_path).parent().ok_or_else(|| "No se pudo determinar la carpeta.".to_string())?;
    open::that(folder).map_err(|e| format!("No se pudo abrir la carpeta: {e}"))
}
