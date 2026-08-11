use std::path::Path;
use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::commands::audit::record_audit_event;
use crate::db::Db;

#[derive(Serialize)]
pub struct CommandOutput {
    pub success: bool,
    pub output: String,
}

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

/// Runs the given script file with the interpreter matching its extension
/// (using a local venv's Python if one exists next to the script) and
/// returns its combined stdout/stderr. Runs with its working directory set
/// to the script's own folder — the same convention an IDE's "Run" button
/// uses, so relative paths and local `node_modules` resolve correctly.
/// This blocks until the script exits — a script that waits for
/// interactive input or runs forever will hang the call, same
/// characteristic as the existing quick-tools commands (ping, nmap).
#[tauri::command]
pub fn run_script(path: String, db: State<'_, Db>) -> Result<CommandOutput, String> {
    let p = Path::new(&path);
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
            let success = out.status.success();
            record_audit_event(&db, "run_script", &path, if success { "ok" } else { "error" }, None);
            Ok(CommandOutput { success, output: text })
        }
        Err(e) => {
            let msg = format!("No se pudo ejecutar '{program}': {e}. ¿Esta instalado y en el PATH?");
            record_audit_event(&db, "run_script", &path, "error", Some(&msg));
            Err(msg)
        }
    }
}
