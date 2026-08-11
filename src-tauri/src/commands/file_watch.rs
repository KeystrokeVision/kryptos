use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Live watchers, keyed by a frontend-generated watch id. Dropping a
/// watcher (removing it from the map) actually stops it — validated this
/// during development: after removal, further filesystem changes produce
/// no further events.
#[derive(Default)]
pub struct FileWatchManager(Mutex<HashMap<String, RecommendedWatcher>>);

#[derive(Clone, Serialize)]
struct FileWatchEventPayload {
    #[serde(rename = "watchId")]
    watch_id: String,
    kind: String,
    paths: Vec<String>,
}

fn describe_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(_) => Some("modified"),
        EventKind::Remove(_) => Some("removed"),
        _ => None, // access/metadata-only events are noisy and rarely interesting for a security watch
    }
}

/// Starts watching a folder (recursively) for create/modify/delete events
/// and streams them as `filewatch://event`. Meant for a handful of
/// critical paths (`/etc`, `C:\Windows\System32\drivers\etc`, a config
/// directory) — not a general-purpose bulk file indexer.
#[tauri::command]
pub fn start_file_watch(app: AppHandle, manager: State<'_, FileWatchManager>, watch_id: String, path: String) -> Result<(), String> {
    {
        let map = manager.0.lock().map_err(|_| "Estado del vigilante de archivos bloqueado.".to_string())?;
        if map.contains_key(&watch_id) {
            return Err(format!("La vigilancia '{watch_id}' ya esta activa."));
        }
    }

    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("La ruta '{path}' no existe."));
    }

    let emit_watch_id = watch_id.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| match res {
        Ok(event) => {
            let Some(kind) = describe_kind(&event.kind) else { return };
            let payload = FileWatchEventPayload {
                watch_id: emit_watch_id.clone(),
                kind: kind.to_string(),
                paths: event.paths.iter().map(|p| p.display().to_string()).collect(),
            };
            let _ = app.emit("filewatch://event", payload);
        }
        Err(e) => {
            let _ = app.emit(
                "filewatch://event",
                FileWatchEventPayload { watch_id: emit_watch_id.clone(), kind: "error".to_string(), paths: vec![e.to_string()] },
            );
        }
    })
    .map_err(|e| format!("No se pudo iniciar el vigilante: {e}"))?;

    watcher.watch(target, RecursiveMode::Recursive).map_err(|e| format!("No se pudo vigilar '{path}': {e}"))?;

    let mut map = manager.0.lock().map_err(|_| "Estado del vigilante de archivos bloqueado.".to_string())?;
    map.insert(watch_id, watcher);
    Ok(())
}

/// Stops a watch. Safe to call even if it already stopped for another
/// reason.
#[tauri::command]
pub fn stop_file_watch(manager: State<'_, FileWatchManager>, watch_id: String) -> Result<(), String> {
    let mut map = manager.0.lock().map_err(|_| "Estado del vigilante de archivos bloqueado.".to_string())?;
    map.remove(&watch_id);
    Ok(())
}

/// Lists which watches are currently active.
#[tauri::command]
pub fn list_active_watches(manager: State<'_, FileWatchManager>) -> Result<Vec<String>, String> {
    let map = manager.0.lock().map_err(|_| "Estado del vigilante de archivos bloqueado.".to_string())?;
    Ok(map.keys().cloned().collect())
}
