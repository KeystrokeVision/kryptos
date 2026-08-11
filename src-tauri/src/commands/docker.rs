use bollard::container::{Config, CreateContainerOptions, ListContainersOptions, LogsOptions, RemoveContainerOptions, StopContainerOptions};
use bollard::image::{CreateImageOptions, ListImagesOptions, RemoveImageOptions};
use bollard::models::{HostConfig, PortBinding};
use bollard::Docker;
use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

fn connect() -> Result<Docker, String> {
    Docker::connect_with_local_defaults().map_err(|e| {
        format!("No se pudo conectar a Docker: {e}. ¿Esta Docker Desktop / el daemon corriendo?")
    })
}

/// Quick connectivity check the frontend can use before rendering the rest
/// of the module — pings the daemon rather than assuming a socket/pipe
/// existing means it's actually responding.
#[tauri::command]
pub async fn is_docker_available() -> bool {
    match connect() {
        Ok(docker) => docker.ping().await.is_ok(),
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub ports: Vec<String>,
    pub created_unix: i64,
}

#[tauri::command]
pub async fn list_containers(all: bool) -> Result<Vec<ContainerInfo>, String> {
    let docker = connect()?;
    let options = Some(ListContainersOptions::<String> { all, ..Default::default() });
    let containers = docker.list_containers(options).await.map_err(|e| format!("No se pudo listar los contenedores: {e}"))?;

    Ok(containers
        .into_iter()
        .map(|c| {
            let name = c.names.and_then(|n| n.into_iter().next()).map(|n| n.trim_start_matches('/').to_string()).unwrap_or_default();
            let ports = c
                .ports
                .unwrap_or_default()
                .into_iter()
                .filter_map(|p| {
                    let public = p.public_port.map(|pp| format!("{pp}->")).unwrap_or_default();
                    Some(format!("{public}{}/{}", p.private_port, p.typ.map(|t| format!("{t:?}").to_lowercase()).unwrap_or_default()))
                })
                .collect();
            ContainerInfo {
                id: c.id.unwrap_or_default().chars().take(12).collect(),
                name,
                image: c.image.unwrap_or_default(),
                state: c.state.unwrap_or_default(),
                status: c.status.unwrap_or_default(),
                ports,
                created_unix: c.created.unwrap_or(0),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn start_container(id: String) -> Result<(), String> {
    let docker = connect()?;
    docker.start_container::<String>(&id, None).await.map_err(|e| format!("No se pudo iniciar el contenedor: {e}"))
}

#[tauri::command]
pub async fn stop_container(id: String) -> Result<(), String> {
    let docker = connect()?;
    docker.stop_container(&id, Some(StopContainerOptions { t: 10 })).await.map_err(|e| format!("No se pudo detener el contenedor: {e}"))
}

#[tauri::command]
pub async fn restart_container(id: String) -> Result<(), String> {
    let docker = connect()?;
    docker.restart_container(&id, None).await.map_err(|e| format!("No se pudo reiniciar el contenedor: {e}"))
}

/// Removes a container. `force` also stops it first if it's running — the
/// frontend must confirm with the user before calling this, same
/// convention as every other destructive action in KRYPTOS.
#[tauri::command]
pub async fn remove_container(id: String, force: bool) -> Result<(), String> {
    let docker = connect()?;
    docker
        .remove_container(&id, Some(RemoveContainerOptions { force, ..Default::default() }))
        .await
        .map_err(|e| format!("No se pudo eliminar el contenedor: {e}"))
}

const MAX_LOG_BYTES: usize = 2 * 1024 * 1024; // 2 MB cap so a noisy container can't freeze the UI

/// Fetches the last `tail_lines` of a container's logs as plain text.
#[tauri::command]
pub async fn get_container_logs(id: String, tail_lines: Option<u32>) -> Result<String, String> {
    let docker = connect()?;
    let tail = tail_lines.unwrap_or(200).to_string();
    let mut stream = docker.logs(&id, Some(LogsOptions::<String> { stdout: true, stderr: true, tail, timestamps: true, ..Default::default() }));

    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("No se pudo leer los logs: {e}"))?;
        buf.push_str(&chunk.to_string());
        if buf.len() > MAX_LOG_BYTES {
            buf.push_str("\n[... truncado, hay mas logs de los mostrados ...]\n");
            break;
        }
    }
    Ok(buf)
}

// ---------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct ImageInfo {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub size_bytes: i64,
    pub created_unix: i64,
}

#[tauri::command]
pub async fn list_images() -> Result<Vec<ImageInfo>, String> {
    let docker = connect()?;
    let options = Some(ListImagesOptions::<String> { all: false, ..Default::default() });
    let images = docker.list_images(options).await.map_err(|e| format!("No se pudo listar las imagenes: {e}"))?;

    Ok(images
        .into_iter()
        .map(|i| ImageInfo {
            id: i.id.trim_start_matches("sha256:").chars().take(12).collect(),
            repo_tags: i.repo_tags.into_iter().filter(|t| t != "<none>:<none>").collect(),
            size_bytes: i.size,
            created_unix: i.created,
        })
        .collect())
}

/// Removes an image. Frontend confirms first — same convention as
/// `remove_container`.
#[tauri::command]
pub async fn remove_image(id: String, force: bool) -> Result<(), String> {
    let docker = connect()?;
    docker
        .remove_image(&id, Some(RemoveImageOptions { force, ..Default::default() }), None)
        .await
        .map_err(|e| format!("No se pudo eliminar la imagen: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------
// Laboratorio de practica (Modo Hacker) — descarga y levanta contenedores
// intencionalmente vulnerables (Juice Shop, DVWA, WebGoat...) en Docker
// local. El objetivo sos vos mismo: no hay ningun target remoto involucrado.
// ---------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct PullProgress {
    image: String,
    status: String,
    progress: Option<String>,
    done: bool,
}

/// Descarga una imagen, emitiendo el progreso via evento para que el
/// frontend muestre una barra en vivo en vez de una espera muda.
#[tauri::command]
pub async fn pull_lab_image(app: AppHandle, image: String) -> Result<(), String> {
    let docker = connect()?;
    let options = Some(CreateImageOptions { from_image: image.clone(), ..Default::default() });
    let mut stream = docker.create_image(options, None, None);

    while let Some(update) = stream.next().await {
        let info = update.map_err(|e| format!("No se pudo descargar '{image}': {e}"))?;
        let _ = app.emit(
            "docker://pull-progress",
            PullProgress { image: image.clone(), status: info.status.unwrap_or_default(), progress: info.progress, done: false },
        );
    }
    let _ = app.emit("docker://pull-progress", PullProgress { image, status: "Completo".into(), progress: None, done: true });
    Ok(())
}

/// Crea y arranca un contenedor a partir de una imagen ya descargada,
/// mapeando un unico puerto a localhost. Pensado para el catalogo de
/// laboratorios de practica, no como reemplazo del flujo general de Docker.
#[tauri::command]
pub async fn launch_lab_container(name: String, image: String, host_port: u16, container_port: u16) -> Result<String, String> {
    let docker = connect()?;
    let container_port_key = format!("{container_port}/tcp");

    let mut port_bindings = HashMap::new();
    port_bindings.insert(
        container_port_key.clone(),
        Some(vec![PortBinding { host_ip: Some("127.0.0.1".to_string()), host_port: Some(host_port.to_string()) }]),
    );

    let mut exposed_ports = HashMap::new();
    exposed_ports.insert(container_port_key, HashMap::new());

    let config = Config {
        image: Some(image),
        exposed_ports: Some(exposed_ports),
        host_config: Some(HostConfig { port_bindings: Some(port_bindings), ..Default::default() }),
        ..Default::default()
    };

    let created = docker
        .create_container(Some(CreateContainerOptions { name: name.clone(), platform: None }), config)
        .await
        .map_err(|e| format!("No se pudo crear el contenedor '{name}': {e}"))?;

    docker
        .start_container::<String>(&created.id, None)
        .await
        .map_err(|e| format!("Contenedor creado pero no arranco: {e}"))?;

    Ok(created.id)
}
