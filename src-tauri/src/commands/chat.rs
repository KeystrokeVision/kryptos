use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio::sync::Mutex as TokioMutex;

#[derive(Serialize, Deserialize, Clone)]
struct ChatMessage {
    nick: String,
    text: String,
    #[serde(rename = "timestampUnix")]
    timestamp_unix: i64,
    kind: String,
}

enum ChatConnection {
    Host { broadcast_tx: broadcast::Sender<String>, nick: String },
    Client { writer: OwnedWriteHalf, nick: String },
}

#[derive(Default)]
pub struct ChatManager(TokioMutex<Option<ChatConnection>>);

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn system_line(text: &str) -> String {
    serde_json::to_string(&ChatMessage { nick: "sistema".to_string(), text: text.to_string(), timestamp_unix: now_unix(), kind: "system".to_string() }).unwrap_or_default()
}

/// Starts hosting a chat on this machine — other KRYPTOS instances on the
/// same network can connect to `<esta-ip>:<port>`.
#[tauri::command]
pub async fn chat_start_server(app: AppHandle, manager: State<'_, ChatManager>, port: u16, nick: String) -> Result<(), String> {
    {
        let guard = manager.0.lock().await;
        if guard.is_some() {
            return Err("Ya hay una sesion de chat activa. Desconectate primero.".into());
        }
    }

    let listener = TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| format!("No se pudo escuchar en el puerto {port}: {e}"))?;
    let (tx, _) = broadcast::channel::<String>(200);

    {
        let mut guard = manager.0.lock().await;
        *guard = Some(ChatConnection::Host { broadcast_tx: tx.clone(), nick: nick.clone() });
    }

    let app_for_local = app.clone();
    let mut local_rx = tx.subscribe();
    tokio::spawn(async move {
        while let Ok(line) = local_rx.recv().await {
            let _ = app_for_local.emit("chat://message", line);
        }
    });

    let _ = tx.send(system_line(&format!("{nick} inicio el servidor de chat en el puerto {port}.")));

    tokio::spawn(async move {
        loop {
            let Ok((socket, _addr)) = listener.accept().await else { break };
            let tx = tx.clone();
            let mut rx = tx.subscribe();
            tokio::spawn(async move {
                let (read_half, mut write_half) = socket.into_split();
                let mut lines = BufReader::new(read_half).lines();
                loop {
                    tokio::select! {
                        line = lines.next_line() => {
                            match line {
                                Ok(Some(msg)) => { let _ = tx.send(msg); }
                                _ => break,
                            }
                        }
                        msg = rx.recv() => {
                            match msg {
                                Ok(msg) => {
                                    if write_half.write_all(format!("{msg}\n").as_bytes()).await.is_err() { break; }
                                }
                                Err(_) => break,
                            }
                        }
                    }
                }
            });
        }
    });

    Ok(())
}

/// Connects out to someone else's KRYPTOS chat server on the network.
#[tauri::command]
pub async fn chat_connect(app: AppHandle, manager: State<'_, ChatManager>, host: String, port: u16, nick: String) -> Result<(), String> {
    {
        let guard = manager.0.lock().await;
        if guard.is_some() {
            return Err("Ya hay una sesion de chat activa. Desconectate primero.".into());
        }
    }

    let stream = TcpStream::connect((host.as_str(), port)).await.map_err(|e| format!("No se pudo conectar a {host}:{port}: {e}"))?;
    let (read_half, writer) = stream.into_split();

    {
        let mut guard = manager.0.lock().await;
        *guard = Some(ChatConnection::Client { writer, nick: nick.clone() });
    }

    let app_clone = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(read_half).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(msg)) => {
                    let _ = app_clone.emit("chat://message", msg);
                }
                _ => {
                    let _ = app_clone.emit("chat://message", system_line("Se perdio la conexion con el servidor."));
                    break;
                }
            }
        }
    });

    chat_send_message(manager, nick.clone(), format!("{nick} se conecto."), true).await?;
    Ok(())
}

/// Sends a message on whichever connection is currently active.
#[tauri::command]
pub async fn chat_send_message(manager: State<'_, ChatManager>, nick: String, text: String, system: bool) -> Result<(), String> {
    let msg = ChatMessage { nick, text, timestamp_unix: now_unix(), kind: if system { "system" } else { "chat" }.to_string() };
    let line = serde_json::to_string(&msg).map_err(|e| format!("No se pudo preparar el mensaje: {e}"))?;

    let mut guard = manager.0.lock().await;
    match guard.as_mut() {
        Some(ChatConnection::Host { broadcast_tx, .. }) => {
            let _ = broadcast_tx.send(line);
            Ok(())
        }
        Some(ChatConnection::Client { writer, .. }) => {
            writer.write_all(format!("{line}\n").as_bytes()).await.map_err(|e| format!("No se pudo enviar: {e}"))
        }
        None => Err("No estas conectado a ningun chat.".into()),
    }
}

/// Difunde el estado de Sentinel de este equipo a todos los demas
/// conectados al mismo chat — es "Modo Flota": el mismo canal P2P del
/// chat, reusado para que el Centro de Operaciones de cada instancia de
/// KRYPTOS pueda mostrar el estado de las otras. El nick queda guardado
/// desde que se inicio/unio al chat, asi que este comando no necesita que
/// el frontend se lo vuelva a pasar.
#[tauri::command]
pub async fn chat_broadcast_status(manager: State<'_, ChatManager>, status_json: String) -> Result<(), String> {
    let mut guard = manager.0.lock().await;
    let line = match guard.as_ref() {
        Some(ChatConnection::Host { nick, .. }) | Some(ChatConnection::Client { nick, .. }) => {
            let msg = ChatMessage { nick: nick.clone(), text: status_json, timestamp_unix: now_unix(), kind: "status".to_string() };
            serde_json::to_string(&msg).map_err(|e| format!("No se pudo preparar el estado: {e}"))?
        }
        None => return Err("No estas conectado a ningun chat.".into()),
    };

    match guard.as_mut() {
        Some(ChatConnection::Host { broadcast_tx, .. }) => {
            let _ = broadcast_tx.send(line);
            Ok(())
        }
        Some(ChatConnection::Client { writer, .. }) => {
            writer.write_all(format!("{line}\n").as_bytes()).await.map_err(|e| format!("No se pudo enviar: {e}"))
        }
        None => Err("No estas conectado a ningun chat.".into()),
    }
}

/// Stops hosting, or disconnects from a remote chat.
#[tauri::command]
pub async fn chat_disconnect(manager: State<'_, ChatManager>) -> Result<(), String> {
    let mut guard = manager.0.lock().await;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn chat_is_active(manager: State<'_, ChatManager>) -> Result<bool, String> {
    Ok(manager.0.lock().await.is_some())
}
