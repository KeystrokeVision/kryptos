//! Dossier de proceso — "quien es este proceso, de verdad".
//!
//! Hoy responder esa pregunta significa abrir Procesos para ver el nombre
//! y PID, Red para ver sus conexiones, y una terminal aparte para calcular
//! el hash o revisar la firma digital. Este comando arma las cuatro cosas
//! de una — hash SHA-256, firma digital (Windows), linaje (quien lo lanzo),
//! conexiones activas y cualquier evento de Sentinel relacionado — en una
//! sola llamada, porque los datos ya viven en el mismo proceso.

use std::path::Path;

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::State;

use crate::commands::network_details::ConnectionInfo;
use crate::commands::sentinel::SentinelEvent;
use crate::commands::security::hash_file_bytes;
use crate::db::Db;

#[derive(Serialize)]
pub struct SignatureInfo {
    /// "valida" | "invalida" | "no_firmado" | "no_disponible"
    pub status: String,
    pub subject: Option<String>,
}

#[derive(Serialize)]
pub struct AncestorInfo {
    pub pid: u32,
    pub name: String,
}

#[derive(Serialize)]
pub struct ProcessDossier {
    pub pid: u32,
    pub name: String,
    pub exe_path: Option<String>,
    pub cmd: Vec<String>,
    pub status: String,
    pub cpu_usage_percent: f32,
    pub memory_bytes: u64,
    pub start_time_unix: u64,
    pub parent_pid: Option<u32>,
    pub parent_name: Option<String>,
    /// La cadena completa de quien-lanzo-a-quien, del padre inmediato hacia
    /// arriba — no solo el padre directo. Cortada a 32 saltos o al primer
    /// ciclo, por si algun dia sysinfo reporta datos inconsistentes.
    pub ancestors: Vec<AncestorInfo>,
    pub sha256: Option<String>,
    pub signature: SignatureInfo,
    pub connections: Vec<ConnectionInfo>,
    /// Eventos de Sentinel cuyo asunto o detalle mencionan este proceso —
    /// la correlacion automatica que responde "¿ya habia visto algo raro
    /// de este proceso antes?" sin tener que ir a buscarlo a mano.
    pub related_events: Vec<SentinelEvent>,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinSignatureRaw {
    #[serde(rename = "Status")]
    status: String,
    #[serde(rename = "Subject")]
    subject: Option<String>,
}

#[cfg(target_os = "windows")]
fn check_signature(exe_path: &str) -> SignatureInfo {
    let script = format!(
        "$sig = Get-AuthenticodeSignature -LiteralPath '{}'; \
         [PSCustomObject]@{{ Status = $sig.Status.ToString(); Subject = $sig.SignerCertificate.Subject }} | ConvertTo-Json -Compress",
        exe_path.replace('\'', "''")
    );
    let Ok(output) = crate::commands::run_powershell_utf8(&script) else {
        return SignatureInfo { status: "no_disponible".to_string(), subject: None };
    };
    let Ok(raw) = serde_json::from_slice::<WinSignatureRaw>(&output.stdout) else {
        return SignatureInfo { status: "no_disponible".to_string(), subject: None };
    };

    let status = match raw.status.as_str() {
        "Valid" => "valida",
        "NotSigned" => "no_firmado",
        _ => "invalida", // HashMismatch, NotTrusted, UnknownError, etc. — se trata todo lo que no es Valid como sospechoso
    };
    SignatureInfo { status: status.to_string(), subject: raw.subject }
}

#[cfg(not(target_os = "windows"))]
fn check_signature(_exe_path: &str) -> SignatureInfo {
    // Authenticode es un concepto de Windows. Linux/macOS tienen sus
    // propios mecanismos (firma de paquetes, notarizacion) que no se
    // pueden verificar de la misma forma desde aqui — se reporta
    // honestamente que no aplica en vez de fingir un resultado.
    SignatureInfo { status: "no_disponible".to_string(), subject: None }
}

/// Arma el dossier completo de un proceso por su PID. Todo de lectura —
/// no cambia nada en el sistema ni en el proceso investigado.
#[tauri::command]
pub fn investigate_process(pid: u32, db: State<'_, Db>) -> Result<ProcessDossier, String> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let process = sys.process(Pid::from_u32(pid)).ok_or_else(|| format!("No se encontro el proceso con PID {pid}. Puede que ya haya terminado."))?;

    let exe_path = process.exe().map(|p| p.display().to_string());
    let name = process.name().to_string_lossy().to_string();

    let parent_pid = process.parent().map(|p| p.as_u32());
    let parent_name = parent_pid.and_then(|ppid| sys.process(Pid::from_u32(ppid))).map(|p| p.name().to_string_lossy().to_string());

    let mut ancestors = Vec::new();
    let mut seen = std::collections::HashSet::new();
    seen.insert(Pid::from_u32(pid));
    let mut current_parent = process.parent();
    while let Some(ppid) = current_parent {
        if !seen.insert(ppid) || ancestors.len() >= 32 {
            break;
        }
        let Some(parent_proc) = sys.process(ppid) else { break };
        ancestors.push(AncestorInfo { pid: ppid.as_u32(), name: parent_proc.name().to_string_lossy().to_string() });
        current_parent = parent_proc.parent();
    }

    let sha256 = exe_path.as_ref().and_then(|path| hash_file_bytes(Path::new(path)).ok()).map(|(hash, _, _)| hash);
    let signature = exe_path.as_deref().map(check_signature).unwrap_or(SignatureInfo { status: "no_disponible".to_string(), subject: None });

    let connections = crate::commands::network_details::list_active_connections()
        .unwrap_or_default()
        .into_iter()
        .filter(|c| c.pid == Some(pid))
        .collect();

    let related_events = {
        let like_name = format!("%{name}%");
        let like_pid = format!("%PID {pid}%");
        let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, timestamp_unix, source, kind, subject, detail FROM sentinel_events
                 WHERE subject LIKE ?1 OR detail LIKE ?1 OR detail LIKE ?2
                 ORDER BY timestamp_unix DESC LIMIT 20",
            )
            .map_err(|e| format!("No se pudieron consultar los eventos relacionados: {e}"))?;
        let collected = stmt
            .query_map(rusqlite::params![like_name, like_pid], |row| {
                Ok(SentinelEvent { id: row.get(0)?, timestamp_unix: row.get(1)?, source: row.get(2)?, kind: row.get(3)?, subject: row.get(4)?, detail: row.get(5)? })
            })
            .map_err(|e| format!("No se pudieron leer los eventos relacionados: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("No se pudo leer un evento relacionado: {e}"))?;
        collected
    };

    Ok(ProcessDossier {
        pid,
        name,
        exe_path,
        cmd: process.cmd().iter().map(|s| s.to_string_lossy().to_string()).collect(),
        status: process.status().to_string(),
        cpu_usage_percent: process.cpu_usage(),
        memory_bytes: process.memory(),
        start_time_unix: process.start_time(),
        parent_pid,
        parent_name,
        ancestors,
        sha256,
        signature,
        connections,
        related_events,
    })
}
