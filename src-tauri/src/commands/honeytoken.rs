//! Honeytokens — archivos senuelo.
//!
//! La deteccion basada en reglas (puertos, persistencia, defensas) siempre
//! tiene falsos positivos posibles: un desarrollador abre un puerto a
//! proposito, un instalador legitimo se agrega al arranque. Un honeytoken
//! no. Se coloca un archivo con nombre tentador ("contrasenas_banco.txt")
//! en una carpeta comun, y como *ningun programa legitimo instalado tiene
//! razon para tocarlo jamas*, cualquier acceso es una senal casi binaria:
//! algo esta explorando este equipo sin permiso. Es la misma tecnica de
//! decepcion que usa un SOC de verdad, aplicada a un equipo personal.
//!
//! Los eventos y alertas que genera un honeytoken se escriben directo en
//! las tablas de Sentinel (`sentinel_events` / `sentinel_alerts`), asi que
//! aparecen en la misma linea de tiempo unificada — no es un modulo aparte
//! que hay que recordar revisar.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::audit::record_audit_event;
use crate::db::Db;

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[derive(Serialize, Clone)]
pub struct HoneytokenInfo {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub created_at_unix: i64,
    /// false si el archivo ya no esta siendo vigilado (por ejemplo, tras
    /// reiniciar la app y antes de que `honeytoken_rearm_all` lo retome).
    pub armed: bool,
}

/// Vigilantes activos, uno por honeytoken, indexados por el id de la fila
/// en `sentinel_honeytokens`. Igual que `FileWatchManager`: soltar la
/// entrada del mapa detiene la vigilancia de verdad.
#[derive(Default)]
pub struct HoneytokenManager(Mutex<HashMap<i64, RecommendedWatcher>>);

const DECOY_CONTENT: &str = "Este es un archivo señuelo (honeytoken) creado por KRYPTOS.\n\
No contiene informacion real. Su unico proposito es detectar acceso no autorizado:\n\
ningun programa legitimo de este equipo tiene motivo para abrir, editar o mover este archivo.\n";

fn describe_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("creado"),
        EventKind::Modify(_) => Some("modificado"),
        EventKind::Remove(_) => Some("eliminado"),
        _ => None,
    }
}

/// Escribe el evento + la alerta critica directo en las tablas de
/// Sentinel y las emite por los mismos eventos ("sentinel://event",
/// "sentinel://alert") que usa el motor principal, para que el panel de
/// Sentinel no tenga que saber que un honeytoken existe por separado.
fn raise_honeytoken_alert(app: &AppHandle, db: &Db, label: &str, path: &str, action: &str) {
    let timestamp = now_unix();
    let subject = label.to_string();
    let detail = format!("{path} ({action})");

    let event_id = {
        let conn = match db.0.lock() {
            Ok(c) => c,
            Err(_) => return,
        };
        if conn
            .execute(
                "INSERT INTO sentinel_events (timestamp_unix, source, kind, subject, detail) VALUES (?1, 'honeytoken', 'honeytoken-tocado', ?2, ?3)",
                params![timestamp, subject, detail],
            )
            .is_err()
        {
            return;
        }
        let event_id = conn.last_insert_rowid();

        let title = format!("Honeytoken tocado: {label}");
        let alert_detail = format!(
            "El archivo señuelo '{label}' fue {action} en {path}. Ningun programa instalado en este equipo tiene \
             razon legitima para tocarlo — esta es una de las senales mas confiables que puede dar Sentinel. \
             Revisa de inmediato que proceso lo hizo."
        );
        const MITRE: &str = "T1083 — Descubrimiento de archivos y directorios";
        let _ = conn.execute(
            "INSERT INTO sentinel_alerts (timestamp_unix, rule_id, severity, title, detail, event_id, acknowledged, mitre_id)
             VALUES (?1, 'honeytoken-tocado', 'critica', ?2, ?3, ?4, 0, ?5)",
            params![timestamp, title, alert_detail, event_id, MITRE],
        );
        event_id
    };

    let _ = app.emit(
        "sentinel://event",
        serde_json::json!({ "id": event_id, "timestamp_unix": timestamp, "source": "honeytoken", "kind": "honeytoken-tocado", "subject": subject, "detail": detail }),
    );
    let _ = app.emit(
        "sentinel://alert",
        serde_json::json!({
            "id": event_id, "timestamp_unix": timestamp, "rule_id": "honeytoken-tocado", "severity": "critica",
            "title": format!("Honeytoken tocado: {label}"), "detail": detail, "event_id": event_id, "acknowledged": false,
            "mitre_id": "T1083 — Descubrimiento de archivos y directorios"
        }),
    );
}

fn arm_watch(app: AppHandle, label: String, path: String) -> Result<RecommendedWatcher, String> {
    let target = Path::new(&path).to_path_buf();
    let watch_label = label.clone();
    let watch_path = path.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(event) = res else { return };
        let Some(action) = describe_kind(&event.kind) else { return };
        let db = app.state::<Db>();
        raise_honeytoken_alert(&app, &db, &watch_label, &watch_path, action);
    })
    .map_err(|e| format!("No se pudo armar la vigilancia del honeytoken: {e}"))?;

    watcher.watch(&target, RecursiveMode::NonRecursive).map_err(|e| format!("No se pudo vigilar '{path}': {e}"))?;
    Ok(watcher)
}

/// Crea un archivo senuelo en `directory` con el nombre `file_name` y
/// empieza a vigilarlo. Se niega a sobreescribir un archivo que ya exista
/// — un honeytoken nunca debe pisar algo real del usuario.
#[tauri::command]
pub fn honeytoken_deploy(
    app: AppHandle,
    db: State<'_, Db>,
    manager: State<'_, HoneytokenManager>,
    label: String,
    directory: String,
    file_name: String,
) -> Result<HoneytokenInfo, String> {
    let dir = Path::new(&directory);
    if !dir.is_dir() {
        return Err(format!("'{directory}' no es una carpeta valida."));
    }
    let full_path = dir.join(&file_name);
    if full_path.exists() {
        return Err(format!("Ya existe un archivo en '{}' — elige otro nombre.", full_path.display()));
    }

    std::fs::write(&full_path, DECOY_CONTENT).map_err(|e| format!("No se pudo crear el honeytoken: {e}"))?;
    let path_str = full_path.display().to_string();
    let created_at_unix = now_unix();

    let id = {
        let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
        conn.execute(
            "INSERT INTO sentinel_honeytokens (path, label, created_at_unix) VALUES (?1, ?2, ?3)",
            params![path_str, label, created_at_unix],
        )
        .map_err(|e| {
            let _ = std::fs::remove_file(&full_path);
            format!("No se pudo registrar el honeytoken: {e}")
        })?;
        conn.last_insert_rowid()
    };

    let watcher = arm_watch(app.clone(), label.clone(), path_str.clone())?;
    manager.0.lock().map_err(|_| "Estado de honeytokens bloqueado.".to_string())?.insert(id, watcher);

    record_audit_event(&db, "Honeytoken desplegado", &path_str, "exito", Some(&label));
    Ok(HoneytokenInfo { id, path: path_str, label, created_at_unix, armed: true })
}

#[tauri::command]
pub fn honeytoken_list(db: State<'_, Db>, manager: State<'_, HoneytokenManager>) -> Result<Vec<HoneytokenInfo>, String> {
    let armed_ids = manager.0.lock().map_err(|_| "Estado de honeytokens bloqueado.".to_string())?;
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, path, label, created_at_unix FROM sentinel_honeytokens ORDER BY created_at_unix DESC")
        .map_err(|e| format!("No se pudo consultar los honeytokens: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            Ok(HoneytokenInfo { id, path: row.get(1)?, label: row.get(2)?, created_at_unix: row.get(3)?, armed: armed_ids.contains_key(&id) })
        })
        .map_err(|e| format!("No se pudieron leer los honeytokens: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer un honeytoken: {e}"))
}

/// Vuelve a armar la vigilancia de todos los honeytokens registrados cuyo
/// archivo todavia exista. Se llama una vez al abrir la app (los
/// vigilantes viven en memoria y no sobreviven un reinicio del proceso),
/// y es seguro llamarla varias veces: nunca duplica un vigilante que ya
/// esta activo.
#[tauri::command]
pub fn honeytoken_rearm_all(app: AppHandle, db: State<'_, Db>, manager: State<'_, HoneytokenManager>) -> Result<usize, String> {
    let rows: Vec<(i64, String, String)> = {
        let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, path, label FROM sentinel_honeytokens")
            .map_err(|e| format!("No se pudo consultar los honeytokens: {e}"))?;
        let collected = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| format!("No se pudieron leer los honeytokens: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("No se pudo leer un honeytoken: {e}"))?;
        collected
    };

    let mut armed = 0usize;
    let mut map = manager.0.lock().map_err(|_| "Estado de honeytokens bloqueado.".to_string())?;
    for (id, path, label) in rows {
        if map.contains_key(&id) || !Path::new(&path).exists() {
            continue;
        }
        if let Ok(watcher) = arm_watch(app.clone(), label, path) {
            map.insert(id, watcher);
            armed += 1;
        }
    }
    Ok(armed)
}

/// Quita un honeytoken: detiene su vigilancia, borra el registro y borra
/// el archivo del disco (mejor esfuerzo — si ya no existe, no es un
/// error). El frontend confirma con el usuario antes de llamar esto.
#[tauri::command]
pub fn honeytoken_remove(db: State<'_, Db>, manager: State<'_, HoneytokenManager>, id: i64) -> Result<(), String> {
    manager.0.lock().map_err(|_| "Estado de honeytokens bloqueado.".to_string())?.remove(&id);

    let path: Option<String> = {
        let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
        let path = conn.query_row("SELECT path FROM sentinel_honeytokens WHERE id = ?1", params![id], |row| row.get(0)).ok();
        conn.execute("DELETE FROM sentinel_honeytokens WHERE id = ?1", params![id])
            .map_err(|e| format!("No se pudo quitar el honeytoken: {e}"))?;
        path
    };

    if let Some(path) = &path {
        let _ = std::fs::remove_file(path);
    }
    record_audit_event(&db, "Honeytoken eliminado", path.as_deref().unwrap_or("desconocido"), "exito", None);
    Ok(())
}
