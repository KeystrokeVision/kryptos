use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::db::Db;

#[derive(Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub timestamp_unix: i64,
    pub action: String,
    pub target: String,
    pub result: String,
    pub details: Option<String>,
}

/// Called from other command modules right after a critical/destructive
/// operation (killing a process, deleting a baseline or firewall rule,
/// removing an app shortcut) — never by the frontend directly. Failure to
/// write the audit row is logged to stderr but never fails the caller's
/// actual operation; losing an audit entry shouldn't block the user's work.
pub fn record_audit_event(db: &Db, action: &str, target: &str, result: &str, details: Option<&str>) {
    let timestamp_unix = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let write = || -> rusqlite::Result<()> {
        let conn = db.0.lock().expect("audit db mutex poisoned");
        conn.execute(
            "INSERT INTO audit_log (timestamp_unix, action, target, result, details) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![timestamp_unix, action, target, result, details],
        )?;
        Ok(())
    };
    if let Err(e) = write() {
        eprintln!("[kryptos] no se pudo registrar el evento de auditoria: {e}");
    }
}

/// Returns the most recent audit entries, newest first.
#[tauri::command]
pub fn list_audit_log(db: State<'_, Db>, limit: Option<u32>) -> Result<Vec<AuditEntry>, String> {
    let limit = limit.unwrap_or(200).min(2000);
    let conn = db.0.lock().map_err(|_| "No se pudo acceder al historial de auditoria.".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, timestamp_unix, action, target, result, details FROM audit_log ORDER BY timestamp_unix DESC LIMIT ?1")
        .map_err(|e| format!("No se pudo consultar el historial: {e}"))?;

    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                timestamp_unix: row.get(1)?,
                action: row.get(2)?,
                target: row.get(3)?,
                result: row.get(4)?,
                details: row.get(5)?,
            })
        })
        .map_err(|e| format!("No se pudo leer el historial: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer una fila del historial: {e}"))
}

/// Wipes the local audit history. The frontend must confirm with the user
/// before calling this.
#[tauri::command]
pub fn clear_audit_log(db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder al historial de auditoria.".to_string())?;
    conn.execute("DELETE FROM audit_log", []).map_err(|e| format!("No se pudo limpiar el historial: {e}"))?;
    Ok(())
}

#[derive(Serialize)]
pub struct AuditExport {
    pub json: String,
    pub sha256: String,
    pub entry_count: usize,
    pub exported_at_unix: i64,
}

/// Exports the entire audit history as JSON, plus a SHA-256 hash of that
/// exact JSON text. The frontend saves both the export and the hash
/// (as a `.sha256` sidecar file) — anyone can later re-hash the export
/// and compare it to that sidecar to confirm the file wasn't edited after
/// export, the same chain-of-custody pattern `sha256sum` gives you for any
/// file, applied to this app's own audit trail.
#[tauri::command]
pub fn export_audit_log(db: State<'_, Db>) -> Result<AuditExport, String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder al historial de auditoria.".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, timestamp_unix, action, target, result, details FROM audit_log ORDER BY timestamp_unix ASC")
        .map_err(|e| format!("No se pudo consultar el historial: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                timestamp_unix: row.get(1)?,
                action: row.get(2)?,
                target: row.get(3)?,
                result: row.get(4)?,
                details: row.get(5)?,
            })
        })
        .map_err(|e| format!("No se pudo leer el historial: {e}"))?;
    let entries: Vec<AuditEntry> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer una fila del historial: {e}"))?;
    drop(stmt);
    drop(conn);

    let json = serde_json::to_string_pretty(&entries).map_err(|e| format!("No se pudo generar el export: {e}"))?;

    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    let sha256 = format!("{:x}", hasher.finalize());

    Ok(AuditExport {
        entry_count: entries.len(),
        json,
        sha256,
        exported_at_unix: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0),
    })
}
