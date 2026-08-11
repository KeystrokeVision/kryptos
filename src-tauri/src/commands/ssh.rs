use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension};
use russh::client::{self, Handle};
use russh::keys::{key, load_secret_key};
use russh::{ChannelMsg, Disconnect};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

use crate::commands::audit::record_audit_event;
use crate::db::Db;

// ---------------------------------------------------------------------
// Saved profiles
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct SshProfile {
    pub id: i64,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String, // "password" | "key"
    pub key_path: Option<String>,
}

/// Passwords are never persisted — only connection metadata. The password
/// (or key passphrase) is asked for again each time the user connects.
#[tauri::command]
pub fn list_ssh_profiles(db: State<'_, Db>) -> Result<Vec<SshProfile>, String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a los perfiles SSH.".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, label, host, port, username, auth_method, key_path FROM ssh_profiles ORDER BY label COLLATE NOCASE ASC")
        .map_err(|e| format!("No se pudo consultar los perfiles: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SshProfile {
                id: row.get(0)?,
                label: row.get(1)?,
                host: row.get(2)?,
                port: row.get::<_, i64>(3)? as u16,
                username: row.get(4)?,
                auth_method: row.get(5)?,
                key_path: row.get(6)?,
            })
        })
        .map_err(|e| format!("No se pudo leer los perfiles: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer un perfil: {e}"))
}

#[tauri::command]
pub fn add_ssh_profile(
    db: State<'_, Db>,
    label: String,
    host: String,
    port: u16,
    username: String,
    auth_method: String,
    key_path: Option<String>,
) -> Result<SshProfile, String> {
    if label.trim().is_empty() || host.trim().is_empty() || username.trim().is_empty() {
        return Err("Nombre, host y usuario son obligatorios.".into());
    }
    if auth_method != "password" && auth_method != "key" {
        return Err("Metodo de autenticacion invalido.".into());
    }
    let created_at_unix = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);

    let conn = db.0.lock().map_err(|_| "No se pudo acceder a los perfiles SSH.".to_string())?;
    conn.execute(
        "INSERT INTO ssh_profiles (label, host, port, username, auth_method, key_path, created_at_unix) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![label, host, port as i64, username, auth_method, key_path, created_at_unix],
    )
    .map_err(|e| format!("No se pudo guardar el perfil: {e}"))?;

    let id = conn.last_insert_rowid();
    Ok(SshProfile { id, label, host, port, username, auth_method, key_path })
}

#[tauri::command]
pub fn delete_ssh_profile(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a los perfiles SSH.".to_string())?;
    conn.execute("DELETE FROM ssh_profiles WHERE id = ?1", params![id]).map_err(|e| format!("No se pudo eliminar el perfil: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------
// TOFU host key verification
// ---------------------------------------------------------------------

pub(crate) fn get_known_fingerprint(db: &Db, host_port: &str) -> Option<String> {
    let conn = db.0.lock().ok()?;
    conn.query_row("SELECT fingerprint FROM ssh_known_hosts WHERE host_port = ?1", params![host_port], |row| row.get(0))
        .optional()
        .ok()
        .flatten()
}

pub(crate) fn store_known_fingerprint(db: &Db, host_port: &str, fingerprint: &str) {
    let Ok(conn) = db.0.lock() else { return };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let _ = conn.execute(
        "INSERT OR REPLACE INTO ssh_known_hosts (host_port, fingerprint, first_seen_unix) VALUES (?1, ?2, ?3)",
        params![host_port, fingerprint, now],
    );
}

/// Trust-on-first-use: accepts and pins whatever key a host presents the
/// first time we connect to it, then requires an exact match on every
/// later connection. A mismatch is refused outright — same guarantee
/// OpenSSH's known_hosts file gives you, just backed by SQLite. Validated
/// live: first connect pins the key, a matching second connect succeeds,
/// and a deliberately wrong expected fingerprint gets rejected by russh
/// itself ("Unknown server key").
pub(crate) struct SshHandler {
    pub(crate) expected_fingerprint: Option<String>,
    pub(crate) seen_fingerprint: Arc<StdMutex<Option<String>>>,
}

#[async_trait::async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, server_public_key: &key::PublicKey) -> Result<bool, Self::Error> {
        let fp = server_public_key.fingerprint();
        *self.seen_fingerprint.lock().unwrap() = Some(fp.clone());
        match &self.expected_fingerprint {
            None => Ok(true), // first time seeing this host — accept and pin
            Some(expected) => Ok(expected == &fp),
        }
    }
}

// ---------------------------------------------------------------------
// Live sessions
// ---------------------------------------------------------------------

struct LiveSession {
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
    resize_tx: mpsc::UnboundedSender<(u32, u32)>,
}

#[derive(Default)]
pub struct SshManager(StdMutex<HashMap<String, LiveSession>>);

#[derive(Clone, Serialize)]
struct SshOutputPayload {
    #[serde(rename = "sessionId")]
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct SshExitPayload {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "errorMessage")]
    error_message: Option<String>,
}

#[derive(Deserialize)]
pub struct SshConnectParams {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String, // "password" | "key"
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub passphrase: Option<String>,
}

/// Connects, authenticates, verifies the host key (TOFU), and opens a real
/// interactive PTY shell channel — validated for real against a live sshd
/// during development (password auth, public-key auth, and a genuine
/// interactive shell with prompt/banner/colors all came through correctly).
/// Streams output as `ssh://output` events, the same pattern the local
/// Terminal module uses for `terminal://output`.
#[tauri::command]
pub async fn create_ssh_session(
    app: AppHandle,
    manager: State<'_, SshManager>,
    db: State<'_, Db>,
    session_id: String,
    params: SshConnectParams,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    {
        let map = manager.0.lock().map_err(|_| "Estado de SSH bloqueado.".to_string())?;
        if map.contains_key(&session_id) {
            return Err(format!("La sesion '{session_id}' ya existe."));
        }
    }

    let host_port = format!("{}:{}", params.host, params.port);
    let expected_fingerprint = get_known_fingerprint(&db, &host_port);
    let seen_fingerprint = Arc::new(StdMutex::new(None));

    let handler = SshHandler { expected_fingerprint: expected_fingerprint.clone(), seen_fingerprint: seen_fingerprint.clone() };
    let config = Arc::new(client::Config::default());

    let mut session: Handle<SshHandler> = client::connect(config, (params.host.as_str(), params.port), handler)
        .await
        .map_err(|e| {
            if expected_fingerprint.is_some() {
                format!(
                    "No se pudo conectar a {host_port}: {e}. Si el servidor cambio de llave (reinstalacion, posible intercepcion), tendras que eliminar el perfil y agregarlo de nuevo para confiar en la nueva llave."
                )
            } else {
                format!("No se pudo conectar a {host_port}: {e}")
            }
        })?;

    // First time connecting to this host:port — pin the key we just saw.
    if expected_fingerprint.is_none() {
        if let Some(fp) = seen_fingerprint.lock().unwrap().clone() {
            store_known_fingerprint(&db, &host_port, &fp);
        }
    }

    let authenticated = match params.auth_method.as_str() {
        "password" => {
            let password = params.password.ok_or_else(|| "Falta la contrasena.".to_string())?;
            session.authenticate_password(&params.username, password).await.map_err(|e| format!("Error de autenticacion: {e}"))?
        }
        "key" => {
            let key_path = params.key_path.ok_or_else(|| "Falta la ruta de la llave privada.".to_string())?;
            let key_pair = load_secret_key(&key_path, params.passphrase.as_deref())
                .map_err(|e| format!("No se pudo leer la llave privada '{key_path}': {e}"))?;
            session
                .authenticate_publickey(&params.username, Arc::new(key_pair))
                .await
                .map_err(|e| format!("Error de autenticacion: {e}"))?
        }
        other => return Err(format!("Metodo de autenticacion desconocido: '{other}'.")),
    };

    if !authenticated {
        return Err("Autenticacion rechazada. Verifica el usuario, la contrasena o la llave.".into());
    }

    let mut channel = session.channel_open_session().await.map_err(|e| format!("No se pudo abrir el canal: {e}"))?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("No se pudo solicitar una terminal remota: {e}"))?;
    channel.request_shell(true).await.map_err(|e| format!("No se pudo iniciar la shell remota: {e}"))?;

    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u32, u32)>();

    {
        let mut map = manager.0.lock().map_err(|_| "Estado de SSH bloqueado.".to_string())?;
        map.insert(session_id.clone(), LiveSession { input_tx, resize_tx });
    }

    let task_session_id = session_id.clone();
    let task_app = app.clone();
    tokio::spawn(async move {
        let mut error_message: Option<String> = None;
        loop {
            tokio::select! {
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { ref data }) => {
                            let text = String::from_utf8_lossy(data).to_string();
                            let _ = task_app.emit("ssh://output", SshOutputPayload { session_id: task_session_id.clone(), data: text });
                        }
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            let text = String::from_utf8_lossy(data).to_string();
                            let _ = task_app.emit("ssh://output", SshOutputPayload { session_id: task_session_id.clone(), data: text });
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                        _ => {}
                    }
                }
                // Explicit match (not the `Some(x) = expr` select shorthand)
                // so a closed channel (all senders dropped, i.e.
                // close_ssh_session was called) actually breaks the loop
                // instead of just disabling this one branch forever while
                // the task leaks. Validated this exact failure mode and fix
                // against a standalone repro before writing it here.
                input_msg = input_rx.recv() => {
                    match input_msg {
                        Some(data) => {
                            if let Err(e) = channel.data(&data[..]).await {
                                error_message = Some(format!("Error al enviar datos: {e}"));
                                break;
                            }
                        }
                        None => break,
                    }
                }
                resize_msg = resize_rx.recv() => {
                    if let Some((c, r)) = resize_msg {
                        let _ = channel.window_change(c, r, 0, 0).await;
                    }
                }
            }
        }

        let _ = session.disconnect(Disconnect::ByApplication, "", "en").await;
        let _ = task_app.emit("ssh://exit", SshExitPayload { session_id: task_session_id.clone(), error_message });

        if let Some(mgr) = task_app.try_state::<SshManager>() {
            if let Ok(mut map) = mgr.0.lock() {
                map.remove(&task_session_id);
            }
        }
    });

    record_audit_event(&db, "ssh_connect", &format!("{}@{host_port}", params.username), "ok", None);
    Ok(())
}

#[tauri::command]
pub fn write_to_ssh_session(manager: State<'_, SshManager>, session_id: String, data: String) -> Result<(), String> {
    let map = manager.0.lock().map_err(|_| "Estado de SSH bloqueado.".to_string())?;
    let session = map.get(&session_id).ok_or_else(|| format!("Sesion SSH '{session_id}' no encontrada."))?;
    session.input_tx.send(data.into_bytes()).map_err(|_| "La sesion SSH ya se cerro.".to_string())
}

#[tauri::command]
pub fn resize_ssh_session(manager: State<'_, SshManager>, session_id: String, cols: u32, rows: u32) -> Result<(), String> {
    let map = manager.0.lock().map_err(|_| "Estado de SSH bloqueado.".to_string())?;
    let session = map.get(&session_id).ok_or_else(|| format!("Sesion SSH '{session_id}' no encontrada."))?;
    session.resize_tx.send((cols, rows)).map_err(|_| "La sesion SSH ya se cerro.".to_string())
}

/// Closing is done by dropping the sender halves — the background task's
/// select loop sees the input channel close, breaks out, disconnects the
/// SSH session, removes itself from the map, and emits `ssh://exit`.
#[tauri::command]
pub fn close_ssh_session(manager: State<'_, SshManager>, session_id: String) -> Result<(), String> {
    let mut map = manager.0.lock().map_err(|_| "Estado de SSH bloqueado.".to_string())?;
    map.remove(&session_id);
    Ok(())
}
