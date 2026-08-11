use std::sync::{Arc, Mutex as StdMutex};

use russh::client::{self, Handle};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::State;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::ssh::{get_known_fingerprint, store_known_fingerprint, SshConnectParams, SshHandler};
use crate::db::Db;

/// Connects, verifies the host key (same TOFU store the interactive SSH
/// sessions use), authenticates, and opens the SFTP subsystem. Each SFTP
/// operation gets its own short-lived connection rather than keeping one
/// open across calls — simpler, and file transfers are infrequent enough
/// that reconnecting each time isn't a meaningful cost.
async fn connect_sftp(db: &Db, params: &SshConnectParams) -> Result<SftpSession, String> {
    let host_port = format!("{}:{}", params.host, params.port);
    let expected_fingerprint = get_known_fingerprint(db, &host_port);
    let seen_fingerprint = Arc::new(StdMutex::new(None));

    let handler = SshHandler { expected_fingerprint: expected_fingerprint.clone(), seen_fingerprint: seen_fingerprint.clone() };
    let config = Arc::new(client::Config::default());

    let mut session: Handle<SshHandler> = client::connect(config, (params.host.as_str(), params.port), handler)
        .await
        .map_err(|e| format!("No se pudo conectar a {host_port}: {e}"))?;

    if expected_fingerprint.is_none() {
        if let Some(fp) = seen_fingerprint.lock().unwrap().clone() {
            store_known_fingerprint(db, &host_port, &fp);
        }
    }

    let authenticated = match params.auth_method.as_str() {
        "password" => {
            let password = params.password.clone().ok_or_else(|| "Falta la contrasena.".to_string())?;
            session.authenticate_password(&params.username, password).await.map_err(|e| format!("Error de autenticacion: {e}"))?
        }
        "key" => {
            let key_path = params.key_path.clone().ok_or_else(|| "Falta la ruta de la llave privada.".to_string())?;
            let key_pair = russh::keys::load_secret_key(&key_path, params.passphrase.as_deref())
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

    let channel = session.channel_open_session().await.map_err(|e| format!("No se pudo abrir el canal: {e}"))?;
    channel.request_subsystem(true, "sftp").await.map_err(|e| format!("El servidor no soporta SFTP: {e}"))?;
    SftpSession::new(channel.into_stream()).await.map_err(|e| format!("No se pudo iniciar la sesion SFTP: {e}"))
}

#[derive(Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_unix: u64,
}

#[tauri::command]
pub async fn sftp_list_directory(db: State<'_, Db>, params: SshConnectParams, path: String) -> Result<Vec<SftpEntry>, String> {
    let sftp = connect_sftp(&db, &params).await?;
    let entries = sftp.read_dir(&path).await.map_err(|e| format!("No se pudo listar '{path}': {e}"))?;

    let mut out = Vec::new();
    for entry in entries {
        let meta = entry.metadata();
        out.push(SftpEntry {
            name: entry.file_name(),
            is_dir: entry.file_type().is_dir(),
            size_bytes: meta.size.unwrap_or(0),
            modified_unix: meta.mtime.unwrap_or(0) as u64,
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let _ = sftp.close().await;
    Ok(out)
}

#[tauri::command]
pub async fn sftp_create_directory(db: State<'_, Db>, params: SshConnectParams, path: String) -> Result<(), String> {
    let sftp = connect_sftp(&db, &params).await?;
    sftp.create_dir(&path).await.map_err(|e| format!("No se pudo crear la carpeta '{path}': {e}"))?;
    let _ = sftp.close().await;
    Ok(())
}

#[tauri::command]
pub async fn sftp_delete_file(db: State<'_, Db>, params: SshConnectParams, path: String) -> Result<(), String> {
    let sftp = connect_sftp(&db, &params).await?;
    sftp.remove_file(&path).await.map_err(|e| format!("No se pudo eliminar '{path}': {e}"))?;
    let _ = sftp.close().await;
    Ok(())
}

/// Downloads a remote file to a local path, streaming rather than
/// buffering the whole thing in memory first.
#[tauri::command]
pub async fn sftp_download_file(db: State<'_, Db>, params: SshConnectParams, remote_path: String, local_path: String) -> Result<(), String> {
    let sftp = connect_sftp(&db, &params).await?;
    let mut remote_file = sftp.open(&remote_path).await.map_err(|e| format!("No se pudo abrir '{remote_path}' en el servidor: {e}"))?;

    let mut local_file = File::create(&local_path).await.map_err(|e| format!("No se pudo crear '{local_path}' localmente: {e}"))?;

    let mut buf = vec![0u8; 65536];
    loop {
        let n = remote_file.read(&mut buf).await.map_err(|e| format!("Error al leer el archivo remoto: {e}"))?;
        if n == 0 {
            break;
        }
        local_file.write_all(&buf[..n]).await.map_err(|e| format!("Error al escribir el archivo local: {e}"))?;
    }
    local_file.flush().await.map_err(|e| format!("No se pudo finalizar la descarga: {e}"))?;
    let _ = sftp.close().await;
    Ok(())
}

/// Uploads a local file to a remote path, streaming rather than loading it
/// entirely into memory first.
#[tauri::command]
pub async fn sftp_upload_file(db: State<'_, Db>, params: SshConnectParams, local_path: String, remote_path: String) -> Result<(), String> {
    let sftp = connect_sftp(&db, &params).await?;

    let mut local_file = File::open(&local_path).await.map_err(|e| format!("No se pudo abrir '{local_path}' localmente: {e}"))?;
    // create(), not write() — write() requires the remote file to already
    // exist, which defeats the point of an upload. Confirmed against a
    // real server before writing this comment.
    let mut remote_file = sftp.create(&remote_path).await.map_err(|e| format!("No se pudo crear '{remote_path}' en el servidor: {e}"))?;

    let mut buf = vec![0u8; 65536];
    loop {
        let n = local_file.read(&mut buf).await.map_err(|e| format!("Error al leer el archivo local: {e}"))?;
        if n == 0 {
            break;
        }
        remote_file.write_all(&buf[..n]).await.map_err(|e| format!("Error al escribir el archivo remoto: {e}"))?;
    }
    remote_file.sync_all().await.map_err(|e| format!("No se pudo finalizar la subida: {e}"))?;
    let _ = sftp.close().await;
    Ok(())
}
