use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// One live shell session: the PTY master (for resize), a writer handle for
/// stdin, and the child process handle (for kill/exit-status). Kept behind
/// `TerminalManager` so multiple terminal tabs — global or the module's own
/// internal tabs — can run concurrently.
struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

/// Shared state registered on the Tauri app. Keyed by a frontend-generated
/// session id (one per xterm.js instance), never by window/tab id, so a
/// module can host as many terminal tabs as it wants.
#[derive(Default)]
pub struct TerminalManager(Mutex<HashMap<String, TerminalSession>>);

#[derive(Clone, Serialize)]
struct TerminalOutputPayload {
    #[serde(rename = "sessionId")]
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExitPayload {
    #[serde(rename = "sessionId")]
    session_id: String,
}

#[derive(Serialize)]
pub struct ShellOption {
    id: String,
    label: String,
}

/// Lists shells that actually exist on this machine, so the picker in the
/// UI never offers something that will fail to spawn.
#[tauri::command]
pub fn list_available_shells() -> Vec<ShellOption> {
    #[cfg(target_os = "windows")]
    {
        vec![
            ShellOption { id: "powershell.exe".into(), label: "PowerShell".into() },
            ShellOption { id: "cmd.exe".into(), label: "Simbolo del sistema (CMD)".into() },
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        const CANDIDATES: &[(&str, &str)] = &[
            ("/bin/bash", "Bash"),
            ("/bin/zsh", "Zsh"),
            ("/usr/bin/fish", "Fish"),
            ("/bin/sh", "Sh"),
        ];
        let mut shells: Vec<ShellOption> = CANDIDATES
            .iter()
            .filter(|(path, _)| std::path::Path::new(path).exists())
            .map(|(path, label)| ShellOption { id: path.to_string(), label: label.to_string() })
            .collect();
        if shells.is_empty() {
            shells.push(ShellOption { id: default_shell(), label: "Shell del sistema".into() });
        }
        shells
    }
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "powershell.exe".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// Spawns a real, interactive shell attached to a pseudo-terminal (native
/// PTY on Unix, ConPTY on Windows via `portable-pty`). Output streams back
/// to the frontend as `terminal://output` events; the frontend feeds
/// keystrokes back with `write_to_terminal`. This is what makes the module
/// a real shell — not a one-shot `Command::output()` call — so interactive
/// programs (vim, ssh, htop, shell prompts) behave normally.
#[tauri::command]
pub fn create_terminal_session(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    {
        let map = state.0.lock().map_err(|_| "Estado de terminal bloqueado.".to_string())?;
        if map.contains_key(&session_id) {
            return Err(format!("La sesion '{session_id}' ya existe."));
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("No se pudo crear el pseudo-terminal: {e}"))?;

    let shell_program = shell.unwrap_or_else(default_shell);
    let mut cmd = CommandBuilder::new(&shell_program);
    // Windows abre cada consola nueva con la pagina de codigos OEM/ANSI del
    // sistema (CP850/1252 en la mayoria de instalaciones en espanol), no
    // UTF-8. Sin esto, cualquier tilde/ene que el shell o un comando
    // imprima (o que el usuario escriba) vuelve como caracteres invalidos
    // y termina mostrandose como "?" en la terminal. `chcp 65001` cambia la
    // pagina de codigos de *esta* sesion de consola antes de que el shell
    // real tome el control, asi que tambien alcanza a los programas nativos
    // que el usuario corra despues (dir, ping, git, etc.), no solo a
    // PowerShell.
    // El prompt de cada shell se reemplaza por uno propio que siempre
    // arranca con "kryptos" — asi la Terminal se identifica como parte de
    // la app incluso pegada a otras consolas abiertas, en vez de mostrar
    // el prompt generico del sistema operativo.
    #[cfg(target_os = "windows")]
    {
        if shell_program.to_lowercase().contains("powershell") || shell_program.to_lowercase().contains("pwsh") {
            cmd.args([
                "-NoExit",
                "-Command",
                "chcp 65001 | Out-Null; Clear-Host; function prompt { 'kryptos PS ' + $PWD.Path + '> ' }",
            ]);
        } else {
            cmd.args(["/K", "chcp 65001>nul && prompt kryptos $P$G"]);
        }
    }
    if let Some(dir) = cwd {
        if !dir.trim().is_empty() {
            cmd.cwd(dir);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        cmd.env("TERM", "xterm-256color");
        let shell_name = shell_program.rsplit('/').next().unwrap_or(&shell_program);
        match shell_name {
            "fish" => {
                cmd.args(["--init-command", "function fish_prompt; echo -n 'kryptos '(prompt_pwd)'> '; end"]);
            }
            // bash, zsh y sh leen PS1 del entorno; para bash/zsh esto puede
            // ser pisado despues por su propio .bashrc/.zshrc, que es el
            // comportamiento esperado (las personalizaciones del usuario
            // ganan), pero sigue siendo el prompt inicial real.
            _ => {
                cmd.env("PS1", "kryptos \\w $ ");
            }
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("No se pudo iniciar '{shell_program}': {e}"))?;
    // The slave end belongs to the child now; the master doesn't need it
    // alive, and holding it open would keep stdin/stdout duplicated.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("No se pudo leer la salida de la terminal: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("No se pudo preparar la entrada de la terminal: {e}"))?;

    {
        let mut map = state.0.lock().map_err(|_| "Estado de terminal bloqueado.".to_string())?;
        map.insert(session_id.clone(), TerminalSession { master: pair.master, writer, child });
    }

    spawn_reader_thread(app, session_id, reader);
    Ok(())
}

/// Reads raw PTY output on a dedicated thread (blocking I/O, since a shell
/// can idle indefinitely) and forwards each chunk to the frontend. When the
/// shell exits, the reader hits EOF, we emit `terminal://exit`, and the
/// session is cleaned up from shared state automatically — the frontend
/// doesn't have to poll for liveness.
fn spawn_reader_thread(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(
                        "terminal://output",
                        TerminalOutputPayload { session_id: session_id.clone(), data },
                    );
                }
                Err(_) => break,
            }
        }

        let _ = app.emit("terminal://exit", TerminalExitPayload { session_id: session_id.clone() });

        if let Some(state) = app.try_state::<TerminalManager>() {
            if let Ok(mut map) = state.0.lock() {
                if let Some(mut session) = map.remove(&session_id) {
                    let _ = session.child.kill();
                }
            }
        }
    });
}

/// Feeds keystrokes/pasted text from xterm.js straight into the shell's
/// stdin. The shell itself (not this command) is responsible for echoing,
/// line editing, and interpreting control sequences — that's the point of
/// using a real PTY instead of reimplementing a line-based fake shell.
#[tauri::command]
pub fn write_to_terminal(state: State<'_, TerminalManager>, session_id: String, data: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|_| "Estado de terminal bloqueado.".to_string())?;
    let session = map
        .get_mut(&session_id)
        .ok_or_else(|| format!("Sesion de terminal '{session_id}' no encontrada."))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Error al escribir en la terminal: {e}"))?;
    session.writer.flush().map_err(|e| format!("Error al vaciar el buffer de la terminal: {e}"))?;
    Ok(())
}

/// Propagates a resize (from `xterm-addon-fit`) down to the PTY so the
/// shell's `$COLUMNS`/`$LINES` and any TUI apps redraw correctly.
#[tauri::command]
pub fn resize_terminal(state: State<'_, TerminalManager>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.0.lock().map_err(|_| "Estado de terminal bloqueado.".to_string())?;
    let session = map
        .get(&session_id)
        .ok_or_else(|| format!("Sesion de terminal '{session_id}' no encontrada."))?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("No se pudo redimensionar la terminal: {e}"))?;
    Ok(())
}

/// Explicitly kills and drops a session (closing a terminal tab). Safe to
/// call even if the shell already exited on its own.
#[tauri::command]
pub fn close_terminal_session(state: State<'_, TerminalManager>, session_id: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|_| "Estado de terminal bloqueado.".to_string())?;
    if let Some(mut session) = map.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}
