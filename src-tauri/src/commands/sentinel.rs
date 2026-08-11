//! Sentinel — el motor de deteccion continua de KRYPTOS.
//!
//! El resto de los modulos de Seguridad responden una pregunta puntual
//! ("como esta el firewall ahora?", "que tareas programadas hay?") y
//! olvidan la respuesta en cuanto cambias de pestana. Sentinel es lo
//! contrario: toma una foto del equipo cada cierto intervalo, la compara
//! contra la foto anterior guardada en SQLite, y convierte cada *diferencia*
//! en un evento. Un motor de reglas evalua esos eventos y genera alertas
//! con severidad.
//!
//! Esto es lo que ninguna herramienta suelta puede hacer: nmap no sabe que
//! tareas programadas tienes, Autoruns no sabe que puertos abriste, y
//! ninguno de los dos sabe que Windows Defender se apago hace cinco
//! minutos. Sentinel si, porque las tres fuentes ya viven en este proceso.
//!
//! Todo es lectura: Sentinel observa y reporta, nunca modifica el sistema.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::audit::record_audit_event;
use crate::db::Db;

/// Only one row ever lives in `sentinel_state` — the previous snapshot.
const SNAPSHOT_KEY: &str = "snapshot";

/// Floor on the tick interval. Each tick shells out to `netstat`/`schtasks`
/// (or `ss`/`crontab`), which is cheap but not free; anything under this
/// would be measurable background load for no extra detection value.
const MIN_INTERVAL_SECS: u64 = 15;
const DEFAULT_INTERVAL_SECS: u64 = 60;

fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

// ---------------------------------------------------------------------
// Lo que viaja al frontend
// ---------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct SentinelEvent {
    pub id: i64,
    pub timestamp_unix: i64,
    /// "red" | "persistencia" | "linea-base" | "motor"
    pub source: String,
    pub kind: String,
    pub subject: String,
    pub detail: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SentinelAlert {
    pub id: i64,
    pub timestamp_unix: i64,
    pub rule_id: String,
    /// "critica" | "alta" | "media" | "baja"
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub event_id: Option<i64>,
    pub acknowledged: bool,
    /// Tecnica de MITRE ATT&CK asociada, si la regla que disparo la
    /// alerta tiene una. Contexto, no una atribucion certera.
    pub mitre_id: Option<String>,
}

#[derive(Serialize)]
pub struct SentinelStatus {
    pub running: bool,
    pub interval_secs: u64,
    pub last_run_unix: i64,
    pub has_baseline: bool,
    pub event_count: i64,
    pub alert_count: i64,
    pub unacknowledged_count: i64,
    pub watched_ports: usize,
    pub watched_persistence: usize,
    /// 0-100, mas alto es mejor: la linea base de defensa combinada con
    /// cuantas alertas pendientes hay y de que severidad. Ver
    /// `compute_posture_score`.
    pub posture_score: u8,
}

#[derive(Serialize, Clone)]
pub struct ScanOutcome {
    pub new_events: usize,
    pub new_alerts: usize,
    pub baseline_established: bool,
}

// ---------------------------------------------------------------------
// La foto del equipo
// ---------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct PortEntry {
    process_name: String,
    exe_path: Option<String>,
    pid: Option<u32>,
    /// true si escucha en 0.0.0.0 / :: — visible desde la red, no solo localmente.
    exposed: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct PersistEntry {
    name: String,
    source: String,
    command: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct LineageEntry {
    parent_name: String,
    child_name: String,
    child_pid: u32,
    child_exe: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct HollowEntry {
    process_name: String,
    pid: u32,
    exe_path: Option<String>,
    /// "ejecutable_eliminado" | "ubicacion_falsificada". `String`, no
    /// `&'static str` — este struct viaja completo a JSON en
    /// `sentinel_state`, y `Deserialize` no se puede derivar sobre un
    /// campo prestado con lifetime 'static.
    reason: String,
}

/// El estado completo del equipo tal como Sentinel lo vio la ultima vez.
/// Se guarda como JSON en `sentinel_state`, asi que la memoria del motor
/// sobrevive a reinicios de la aplicacion.
#[derive(Serialize, Deserialize, Clone, Default)]
struct Snapshot {
    /// "TCP 0.0.0.0:445" -> quien lo abrio
    ports: HashMap<String, PortEntry>,
    /// "Tareas programadas::\\Microsoft\\Windows\\Foo" -> detalle
    persistence: HashMap<String, PersistEntry>,
    /// nombre del chequeo -> "ok" | "warning" | "unknown"
    baseline: HashMap<String, String>,
    baseline_score: u8,
    /// "pid:hora_inicio" -> quien engendro a quien. La clave incluye la
    /// hora de arranque del proceso (no solo el PID) porque Windows y
    /// Linux reciclan PIDs constantemente; sin eso, un proceso normal que
    /// reutiliza un PID viejo se confundiria con el proceso sospechoso
    /// que tenia ese PID antes.
    lineage: HashMap<String, LineageEntry>,
    /// numero de serie / id de dispositivo -> descripcion. Una vez que un
    /// dispositivo USB de almacenamiento se conecta, Windows y Linux dejan
    /// un rastro permanente — esto crece, casi nunca encoge.
    usb_devices: HashMap<String, String>,
    /// "pid:hora_inicio" -> por que se sospecha del proceso ahora mismo
    /// (ejecutable borrado del disco, o un nombre de proceso del sistema
    /// corriendo desde una carpeta que no es la suya).
    hollow_suspects: HashMap<String, HollowEntry>,
}

// ---------------------------------------------------------------------
// Recoleccion
// ---------------------------------------------------------------------

/// pid -> (nombre, ruta del ejecutable). Se arma una sola vez por tick y se
/// consulta para cada puerto en escucha, en vez de refrescar sysinfo por
/// cada uno.
fn process_table() -> HashMap<u32, (String, Option<String>)> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .iter()
        .map(|(pid, p)| {
            let name = p.name().to_string_lossy().to_string();
            let exe = p.exe().map(|e| e.display().to_string());
            (pid.as_u32(), (name, exe))
        })
        .collect()
}

/// Una direccion de escucha en 0.0.0.0, :: o * acepta conexiones desde
/// cualquier interfaz — es decir, desde la red. Una en 127.0.0.1 solo
/// acepta conexiones de este mismo equipo. La diferencia importa mucho
/// para decidir que tan grave es un puerto nuevo.
fn is_exposed(local_addr: &str) -> bool {
    let host = local_addr.rsplit_once(':').map(|(h, _)| h).unwrap_or(local_addr);
    let host = host.trim_matches(['[', ']']);
    matches!(host, "0.0.0.0" | "::" | "*" | "")
}

fn collect_ports() -> HashMap<String, PortEntry> {
    let Ok(connections) = crate::commands::network_details::list_active_connections() else {
        return HashMap::new();
    };
    let processes = process_table();

    connections
        .into_iter()
        .filter(|c| c.state.as_deref().map(|s| s.to_uppercase().contains("LISTEN")).unwrap_or(false))
        .map(|c| {
            let (process_name, exe_path) = c
                .pid
                .and_then(|pid| processes.get(&pid).cloned())
                .unwrap_or_else(|| ("desconocido".to_string(), None));
            let key = format!("{} {}", c.protocol, c.local_addr);
            (key, PortEntry { process_name, exe_path, pid: c.pid, exposed: is_exposed(&c.local_addr) })
        })
        .collect()
}

fn collect_persistence() -> HashMap<String, PersistEntry> {
    let Ok(tasks) = crate::commands::persistence::list_scheduled_tasks() else {
        return HashMap::new();
    };
    tasks
        .into_iter()
        .map(|t| {
            let key = format!("{}::{}", t.source, t.name);
            (key, PersistEntry { name: t.name, source: t.source, command: t.command })
        })
        .collect()
}

/// Programas comunes que un usuario normal ejecuta a diario, pero que
/// **nunca** deberian por si mismos lanzar un interprete de comandos: un
/// documento de Word, un PDF o una pagina web no tienen ninguna razon
/// legitima para abrir PowerShell. Cuando lo hacen, es la firma clasica de
/// una macro maliciosa o un exploit del lector — la tecnica que MITRE
/// ATT&CK cataloga como "living-off-the-land" (T1218): el atacante no trae
/// herramientas propias, usa las que Windows ya trae instaladas.
const HIGH_RISK_PARENTS: &[&str] = &[
    "winword.exe", "excel.exe", "powerpnt.exe", "outlook.exe", "msaccess.exe",
    "acrord32.exe", "acrobat.exe", "foxitreader.exe",
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe",
    "explorer.exe",
];

/// Interpretes y ejecutores de scripts que un atacante usa para moverse
/// una vez dentro — no son maliciosos por existir (un administrador los
/// usa todo el dia), solo cuando los abre un padre de la lista de arriba.
const SHELL_LIKE: &[&str] = &["powershell.exe", "pwsh.exe", "cmd.exe", "wscript.exe", "cscript.exe", "mshta.exe"];

fn collect_lineage() -> HashMap<String, LineageEntry> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let by_pid: HashMap<u32, &sysinfo::Process> = sys.processes().iter().map(|(pid, p)| (pid.as_u32(), p)).collect();

    sys.processes()
        .values()
        .filter_map(|proc| {
            let child_name = proc.name().to_string_lossy().to_lowercase();
            if !SHELL_LIKE.contains(&child_name.as_str()) {
                return None;
            }
            let parent = proc.parent().and_then(|pid| by_pid.get(&pid.as_u32()))?;
            let parent_name = parent.name().to_string_lossy().to_lowercase();
            if !HIGH_RISK_PARENTS.contains(&parent_name.as_str()) {
                return None;
            }

            let key = format!("{}:{}", proc.pid().as_u32(), proc.start_time());
            Some((
                key,
                LineageEntry {
                    parent_name,
                    child_name,
                    child_pid: proc.pid().as_u32(),
                    child_exe: proc.exe().map(|e| e.display().to_string()),
                },
            ))
        })
        .collect()
}

// ---------------------------------------------------------------------
// USB — dispositivos de almacenamiento removible
// ---------------------------------------------------------------------
//
// Es un vector de infeccion (autorun/BadUSB) y de fuga de datos (copiar
// archivos a una memoria y llevarsela) igual de viejo que real. Windows y
// Linux dejan un rastro permanente de todo dispositivo de almacenamiento
// USB que alguna vez se conecto — no hace falta vigilar en tiempo real,
// alcanza con comparar ese registro contra la revision anterior.

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinUsbRaw {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Descriptor")]
    descriptor: String,
}

#[cfg(target_os = "windows")]
fn collect_usb_devices() -> HashMap<String, String> {
    // USBSTOR guarda una subclave por tipo de dispositivo, y dentro de esa
    // una por numero de serie — el numero de serie es lo mas parecido a un
    // identificador estable que da Windows sin necesitar WMI.
    let script = "Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Enum\\USBSTOR' -ErrorAction SilentlyContinue | ForEach-Object { \
        $descriptor = $_.PSChildName; \
        Get-ChildItem $_.PSPath -ErrorAction SilentlyContinue | ForEach-Object { \
            [PSCustomObject]@{ Id = $_.PSChildName; Descriptor = $descriptor } \
        } \
      } | ConvertTo-Json -Compress";

    let Ok(output) = crate::commands::run_powershell_utf8(script) else {
        return HashMap::new();
    };
    let trimmed = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if trimmed.is_empty() {
        return HashMap::new();
    }
    let raw: Vec<WinUsbRaw> = serde_json::from_str::<Vec<WinUsbRaw>>(&trimmed)
        .or_else(|_| serde_json::from_str::<WinUsbRaw>(&trimmed).map(|single| vec![single]))
        .unwrap_or_default();

    raw.into_iter().map(|d| (d.id, d.descriptor)).collect()
}

#[cfg(not(target_os = "windows"))]
fn collect_usb_devices() -> HashMap<String, String> {
    // `lsusb` no distingue "conectado ahora" de "conectado alguna vez", asi
    // que esto refleja dispositivos presentes en este instante — mas
    // limitado que en Windows, pero sigue capturando la conexion de un USB
    // nuevo mientras siga enchufado en el momento de la siguiente revision.
    let Ok(output) = std::process::Command::new("lsusb").output() else { return HashMap::new() };
    if !output.status.success() {
        return HashMap::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let id_pos = line.find("ID ")?;
            let rest = &line[id_pos + 3..];
            let (id, descriptor) = rest.split_once(' ')?;
            Some((id.to_string(), descriptor.trim().to_string()))
        })
        .collect()
}

// ---------------------------------------------------------------------
// Process hollowing / masquerading — sospechas sobre procesos vivos
// ---------------------------------------------------------------------

/// Procesos centrales de Windows que el sistema operativo SIEMPRE ejecuta
/// desde System32 o SysWOW64. Un proceso con uno de estos nombres
/// corriendo desde cualquier otra carpeta esta impersonando un proceso del
/// sistema — la tecnica que MITRE cataloga como masquerading (T1036.005),
/// y una de las señales con menos falsos positivos que existen: no hay
/// una razon legitima para que esto pase nunca.
const SYSTEM_PROCESS_NAMES: &[&str] = &["svchost.exe", "lsass.exe", "csrss.exe", "winlogon.exe", "services.exe", "smss.exe", "wininit.exe"];

fn is_under_system_dir(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.contains("\\windows\\system32\\") || lower.contains("\\windows\\syswow64\\")
}

fn collect_hollow_suspects() -> HashMap<String, HollowEntry> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    sys.processes()
        .values()
        .filter_map(|proc| {
            let name = proc.name().to_string_lossy().to_string();
            let exe_path = proc.exe().map(|e| e.display().to_string());

            let reason = if let Some(path) = &exe_path {
                if !Path::new(path).exists() {
                    // Puede ser un actualizador reemplazando su propio
                    // binario en caliente — de ahi que la regla lo marque
                    // "alta" y no "critica" mas adelante.
                    Some("ejecutable_eliminado")
                } else if SYSTEM_PROCESS_NAMES.contains(&name.to_lowercase().as_str()) && !is_under_system_dir(path) {
                    Some("ubicacion_falsificada")
                } else {
                    None
                }
            } else {
                None
            };

            let reason = reason?;
            let key = format!("{}:{}", proc.pid().as_u32(), proc.start_time());
            Some((key, HollowEntry { process_name: name, pid: proc.pid().as_u32(), exe_path, reason: reason.to_string() }))
        })
        .collect()
}

fn collect_snapshot() -> Snapshot {
    let baseline_result = crate::commands::baseline::run_security_baseline();
    Snapshot {
        ports: collect_ports(),
        persistence: collect_persistence(),
        baseline: baseline_result.checks.iter().map(|c| (c.name.clone(), c.status.clone())).collect(),
        baseline_score: baseline_result.score_percent,
        lineage: collect_lineage(),
        usb_devices: collect_usb_devices(),
        hollow_suspects: collect_hollow_suspects(),
    }
}

// ---------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------

/// Carpetas desde las que el software legitimo casi nunca se ejecuta, y
/// desde las que el malware casi siempre lo hace: temporales, descargas,
/// papelera. No es prueba de nada por si sola — es la razon por la que la
/// alerta sube de severidad, no por la que se genera.
fn suspicious_location(path: &str) -> Option<&'static str> {
    const MARKERS: &[(&str, &str)] = &[
        ("\\appdata\\local\\temp\\", "la carpeta temporal del usuario"),
        ("\\windows\\temp\\", "la carpeta temporal de Windows"),
        ("\\downloads\\", "la carpeta de descargas"),
        ("\\descargas\\", "la carpeta de descargas"),
        ("\\$recycle.bin\\", "la papelera de reciclaje"),
        ("\\users\\public\\", "la carpeta publica de usuarios"),
        ("/tmp/", "/tmp"),
        ("/var/tmp/", "/var/tmp"),
        ("/dev/shm/", "/dev/shm"),
    ];
    let lower = path.to_lowercase();
    MARKERS.iter().find(|(marker, _)| lower.contains(marker)).map(|(_, label)| *label)
}

/// Un evento a punto de escribirse, junto con la alerta que la regla
/// correspondiente decidio levantar (si levanto alguna).
struct Finding {
    source: &'static str,
    kind: &'static str,
    subject: String,
    detail: Option<String>,
    alert: Option<PendingAlert>,
}

struct PendingAlert {
    rule_id: &'static str,
    severity: &'static str,
    title: String,
    detail: String,
    /// Tecnica de MITRE ATT&CK que mejor describe la senal, mostrada tal
    /// cual en la alerta. No es una atribucion certera — es contexto que
    /// le dice a quien la lee, sin buscar nada, en que categoria de
    /// comportamiento cae esto y por que importa.
    mitre: &'static str,
}

/// El corazon del motor: compara dos fotos del equipo y devuelve todo lo
/// que cambio, ya clasificado por severidad.
fn evaluate(previous: &Snapshot, current: &Snapshot) -> Vec<Finding> {
    let mut findings = Vec::new();

    // --- Puertos en escucha -------------------------------------------
    for (key, entry) in &current.ports {
        if previous.ports.contains_key(key) {
            continue;
        }
        let who = match &entry.exe_path {
            Some(path) => format!("{} ({})", entry.process_name, path),
            None => entry.process_name.clone(),
        };
        let pid_text = entry.pid.map(|p| format!(" [PID {p}]")).unwrap_or_default();
        let location = entry.exe_path.as_deref().and_then(suspicious_location);

        const PORT_MITRE: &str = "T1571 — Puerto no estandar (canal de C2)";
        let (rule_id, severity, title, detail) = match (location, entry.exposed) {
            (Some(place), _) => (
                "puerto-escucha-ubicacion-sospechosa",
                "critica",
                format!("Puerto nuevo abierto por un programa en {place}"),
                format!(
                    "{key} lo abrio {who}{pid_text}. El ejecutable esta en {place}, una ubicacion desde la que el \
                     software instalado normalmente no se ejecuta. Revisa que programa es antes de descartarlo."
                ),
            ),
            (None, true) => (
                "puerto-escucha-expuesto",
                "alta",
                format!("Puerto nuevo expuesto a la red: {key}"),
                format!(
                    "{who}{pid_text} empezo a aceptar conexiones desde cualquier equipo de la red, no solo desde \
                     este. Si no lo iniciaste tu, revisa el proceso."
                ),
            ),
            (None, false) => (
                "puerto-escucha-local",
                "baja",
                format!("Puerto nuevo en escucha local: {key}"),
                format!("{who}{pid_text} abrio un puerto accesible solo desde este equipo."),
            ),
        };

        findings.push(Finding {
            source: "red",
            kind: "puerto-escucha-nuevo",
            subject: key.clone(),
            detail: Some(format!("{who}{pid_text}")),
            alert: Some(PendingAlert { rule_id, severity, title, detail, mitre: PORT_MITRE }),
        });
    }

    for key in previous.ports.keys() {
        if !current.ports.contains_key(key) {
            findings.push(Finding {
                source: "red",
                kind: "puerto-escucha-cerrado",
                subject: key.clone(),
                detail: None,
                alert: None, // cerrar un puerto reduce la superficie expuesta: se registra, no se alerta
            });
        }
    }

    // --- Persistencia --------------------------------------------------
    for (key, entry) in &current.persistence {
        if previous.persistence.contains_key(key) {
            continue;
        }
        let location = suspicious_location(&entry.command);
        let (rule_id, severity, title) = match location {
            Some(place) => (
                "persistencia-nueva-ubicacion-sospechosa",
                "critica",
                format!("Nuevo arranque automatico desde {place}"),
            ),
            None => ("persistencia-nueva", "alta", "Nuevo elemento de arranque automatico".to_string()),
        };

        findings.push(Finding {
            source: "persistencia",
            kind: "persistencia-nueva",
            subject: entry.name.clone(),
            detail: Some(entry.command.clone()),
            alert: Some(PendingAlert {
                rule_id,
                severity,
                title,
                detail: format!(
                    "'{}' ({}) quedo configurado para ejecutarse solo. Ejecuta: {}",
                    entry.name, entry.source, entry.command
                ),
                mitre: "T1053 — Tarea programada (persistencia)",
            }),
        });
    }

    for (key, entry) in &previous.persistence {
        if current.persistence.contains_key(key) {
            continue;
        }
        findings.push(Finding {
            source: "persistencia",
            kind: "persistencia-eliminada",
            subject: entry.name.clone(),
            detail: Some(entry.command.clone()),
            alert: Some(PendingAlert {
                rule_id: "persistencia-eliminada",
                severity: "baja",
                title: "Se elimino un elemento de arranque automatico".to_string(),
                detail: format!(
                    "'{}' ({}) ya no esta configurado para ejecutarse solo. Suele ser una desinstalacion normal; \
                     tambien es lo que hace alguien que limpia sus huellas.",
                    entry.name, entry.source
                ),
                mitre: "T1070 — Eliminacion de indicadores (posible limpieza de huellas)",
            }),
        });
    }

    // --- Linea base de defensa -----------------------------------------
    for (name, status) in &current.baseline {
        let Some(before) = previous.baseline.get(name) else { continue };
        if before == status {
            continue;
        }

        // ok -> warning es una defensa que se apago. Es la senal mas fuerte
        // que produce este motor: nada legitimo apaga el firewall solo.
        if before == "ok" && status == "warning" {
            findings.push(Finding {
                source: "linea-base",
                kind: "defensa-desactivada",
                subject: name.clone(),
                detail: Some(format!("{before} -> {status}")),
                alert: Some(PendingAlert {
                    rule_id: "defensa-desactivada",
                    severity: "critica",
                    title: format!("Se desactivo una defensa: {name}"),
                    detail: format!(
                        "El chequeo '{name}' pasaba y ahora no. Si no fuiste tu quien lo cambio, tratalo como un \
                         incidente: es exactamente lo primero que hace un atacante despues de entrar."
                    ),
                    mitre: "T1562.001 — Deshabilitar herramientas de seguridad (evasion de defensas)",
                }),
            });
        } else if status == "ok" {
            findings.push(Finding {
                source: "linea-base",
                kind: "defensa-restaurada",
                subject: name.clone(),
                detail: Some(format!("{before} -> {status}")),
                alert: None,
            });
        } else {
            findings.push(Finding {
                source: "linea-base",
                kind: "defensa-cambiada",
                subject: name.clone(),
                detail: Some(format!("{before} -> {status}")),
                alert: None,
            });
        }
    }

    if current.baseline_score != previous.baseline_score {
        findings.push(Finding {
            source: "linea-base",
            kind: "puntaje-cambiado",
            subject: format!("{}% -> {}%", previous.baseline_score, current.baseline_score),
            detail: None,
            alert: None,
        });
    }

    // --- Linaje de procesos sospechoso (LOLBins) -----------------------
    // Word, el navegador o un PDF abriendo PowerShell no es un cambio de
    // configuracion como los anteriores — es un comportamiento en el
    // instante. No tiene sentido "cerrarse sin alertar" como un puerto:
    // si el proceso ya no esta en la foto actual, simplemente ya
    // termino, no hay nada que reportar de vuelta.
    for (key, entry) in &current.lineage {
        if previous.lineage.contains_key(key) {
            continue;
        }
        let who = match &entry.child_exe {
            Some(path) => format!("{} ({})", entry.child_name, path),
            None => entry.child_name.clone(),
        };
        findings.push(Finding {
            source: "procesos",
            kind: "linaje-sospechoso",
            subject: format!("{} -> {}", entry.parent_name, entry.child_name),
            detail: Some(format!("PID {}: {who}", entry.child_pid)),
            alert: Some(PendingAlert {
                rule_id: "lolbin-cadena-inusual",
                severity: "critica",
                title: format!("{} abrio {} — patron tipico de macro maliciosa", entry.parent_name, entry.child_name),
                detail: format!(
                    "'{}' (PID {}) fue lanzado por '{}'. Ningun documento, pagina web o correo tiene razon \
                     legitima para abrir un interprete de comandos por su cuenta — es la tecnica que se conoce \
                     como living-off-the-land: usar herramientas que Windows ya trae instaladas en vez de traer \
                     las propias. Revisa que estaba abierto en '{}' justo antes de que esto pasara.",
                    entry.child_name, entry.child_pid, entry.parent_name, entry.parent_name
                ),
                mitre: "T1218 — Ejecucion de binarios del sistema (living-off-the-land)",
            }),
        });
    }

    // --- USB / almacenamiento removible ---------------------------------
    for (key, descriptor) in &current.usb_devices {
        if previous.usb_devices.contains_key(key) {
            continue;
        }
        findings.push(Finding {
            source: "usb",
            kind: "usb-nuevo",
            subject: descriptor.clone(),
            detail: Some(key.clone()),
            alert: Some(PendingAlert {
                rule_id: "usb-almacenamiento-nuevo",
                severity: "alta",
                title: format!("Nuevo dispositivo de almacenamiento USB: {descriptor}"),
                detail: format!(
                    "'{descriptor}' se conecto a este equipo por primera vez. La mayoria de las veces es \
                     exactamente lo que parece — tu propio USB — pero es tambien el vector clasico para infectar \
                     un equipo (autorun) o sacarle datos. Si no fuiste tu quien lo conecto, tratalo como un incidente."
                ),
                mitre: "T1091 — Replicacion via medios extraibles",
            }),
        });
    }

    // --- Process hollowing / masquerading -------------------------------
    // Igual que el linaje: es un chequeo del instante, no una configuracion
    // que "se cierra" — cuando el proceso sospechoso ya no esta, no hay
    // nada que reportar de vuelta.
    for (key, entry) in &current.hollow_suspects {
        if previous.hollow_suspects.contains_key(key) {
            continue;
        }
        let (severity, mitre, title, detail) = match entry.reason.as_str() {
            "ubicacion_falsificada" => (
                "critica",
                "T1036.005 — Enmascarar nombre o ubicacion (masquerading)",
                format!("'{}' esta corriendo desde una ubicacion falsa", entry.process_name),
                format!(
                    "El proceso '{}' (PID {}) se llama igual que un proceso central de Windows, pero su \
                     ejecutable esta en '{}' en vez de System32 — Windows nunca ejecuta este proceso desde ahi. \
                     Es una de las tecnicas de evasion mas usadas para esconder malware a simple vista, \
                     haciendolo pasar por un proceso del sistema en el Administrador de tareas.",
                    entry.process_name,
                    entry.pid,
                    entry.exe_path.as_deref().unwrap_or("una ruta desconocida")
                ),
            ),
            _ => (
                "alta",
                "T1070.004 — Eliminacion de archivo (posible auto-eliminacion)",
                format!("El ejecutable de '{}' ya no existe en disco", entry.process_name),
                format!(
                    "El proceso '{}' (PID {}) sigue corriendo en memoria, pero su archivo original ('{}') ya no \
                     esta en disco. Un actualizador reemplazando su propio binario puede verse asi de forma \
                     inocente; tambien es lo que hace malware que se borra a si mismo despues de ejecutarse para \
                     dificultar el analisis forense.",
                    entry.process_name,
                    entry.pid,
                    entry.exe_path.as_deref().unwrap_or("desconocida")
                ),
            ),
        };

        findings.push(Finding {
            source: "procesos",
            kind: "proceso-sospechoso",
            subject: entry.process_name.clone(),
            detail: Some(format!("PID {}: {}", entry.pid, entry.reason)),
            alert: Some(PendingAlert { rule_id: "process-hollowing", severity, title, detail, mitre }),
        });
    }

    findings
}

/// Correlacion de patrones: esto es lo que ninguna herramienta suelta
/// puede hacer, porque ninguna tiene ambas fuentes en el mismo proceso.
/// Un puerto nuevo, solo, puede ser un servidor de desarrollo que
/// arrancaste tu. Un elemento de arranque automatico nuevo, solo, puede
/// ser un instalador legitimo. Los dos apareciendo en la misma revision
/// son el patron clasico de un implante: se instala, se asegura sobrevivir
/// a un reinicio, y abre un canal de vuelta — en ese orden o cualquiera.
/// Cuando eso pasa, la severidad no es la suma de las dos alertas
/// individuales, es una categoria distinta.
fn detect_behavior_chain(findings: &[Finding]) -> Option<Finding> {
    let new_port = findings.iter().find(|f| f.kind == "puerto-escucha-nuevo")?;
    let new_persistence = findings.iter().find(|f| f.kind == "persistencia-nueva")?;

    Some(Finding {
        source: "motor",
        kind: "patron-detectado",
        subject: "Persistencia + puerto nuevo en la misma revision".to_string(),
        detail: Some(format!("Persistencia: {} · Puerto: {}", new_persistence.subject, new_port.subject)),
        alert: Some(PendingAlert {
            rule_id: "cadena-comportamiento",
            severity: "critica",
            title: "Patron de comportamiento tipo implante detectado".to_string(),
            detail: format!(
                "En la misma revision aparecieron un elemento de arranque automatico nuevo ('{}') y un puerto \
                 nuevo en escucha ('{}'). Cada uno por separado puede ser inocente; juntos y al mismo tiempo son \
                 el patron clasico de un implante instalandose. Revisa ambos de inmediato, en ese orden: primero \
                 que proceso abrio el puerto, despues que ejecuta la tarea nueva.",
                new_persistence.subject, new_port.subject
            ),
            mitre: "T1053 + T1571 — Persistencia y canal de C2 combinados",
        }),
    })
}

// ---------------------------------------------------------------------
// Deteccion de beaconing (C2)
// ---------------------------------------------------------------------
//
// Esta es la tecnica que usan los frameworks de post-explotacion reales
// para "llamar a casa" sin levantar sospechas: en vez de mantener una
// conexion abierta (facil de notar), el implante se conecta brevemente al
// servidor de control a intervalos regulares. El trafico humano normal —
// navegar, revisar correo, videollamadas — nunca produce un patron tan
// regular como un temporizador de software. No es diff de una foto contra
// otra como el resto del motor: hace falta ver varias conexiones en el
// tiempo para reconocer el ritmo, asi que Sentinel guarda un historial
// aparte (`sentinel_connection_history`) solo para esto.

/// Cuanto historial de conexiones se analiza en cada revision.
const BEACON_LOOKBACK_SECS: i64 = 6 * 3600;
/// Cuanto tiempo se conserva el historial antes de purgarse — mas que la
/// ventana de analisis, para no cortar datos justo en el borde.
const CONNECTION_HISTORY_RETENTION_SECS: i64 = 24 * 3600;
/// Hacen falta al menos esta cantidad de conexiones distintas al mismo
/// host para poder hablar de un "ritmo" con algo de confianza.
const BEACON_MIN_OBSERVATIONS: usize = 6;
/// Fuera de este rango no se analiza: mas rapido que 10s es trafico
/// interactivo normal (o ruido), mas lento que una hora ya no es lo que
/// tipicamente hace un beacon.
const BEACON_MIN_INTERVAL_SECS: f64 = 10.0;
const BEACON_MAX_INTERVAL_SECS: f64 = 3600.0;
/// Coeficiente de variacion (desviacion estandar / promedio) de los
/// intervalos entre conexiones. Por debajo de este umbral, los intervalos
/// son demasiado parejos para ser trafico humano.
const BEACON_CV_THRESHOLD: f64 = 0.20;
/// Una vez que se alerta de un par (proceso, host), no se vuelve a alertar
/// del mismo par hasta que pase esto — sigue siendo un beacon cada
/// revision, pero avisar cada minuto seria ruido, no informacion.
const BEACON_REALERT_COOLDOWN_SECS: i64 = 6 * 3600;

struct BeaconVerdict {
    mean_secs: f64,
    cv: f64,
    observations: usize,
    severity: &'static str,
}

/// El analisis en si, puro: dada una lista de instantes en los que un
/// mismo proceso hablo con un mismo host, decide si el ritmo es demasiado
/// regular para ser trafico humano. Separado de la consulta SQL para
/// poder probarlo sin base de datos.
fn analyze_beacon(mut timestamps: Vec<i64>) -> Option<BeaconVerdict> {
    timestamps.sort_unstable();
    timestamps.dedup();
    if timestamps.len() < BEACON_MIN_OBSERVATIONS {
        return None;
    }

    let intervals: Vec<f64> = timestamps.windows(2).map(|w| (w[1] - w[0]) as f64).collect();
    let mean = intervals.iter().sum::<f64>() / intervals.len() as f64;
    if !(BEACON_MIN_INTERVAL_SECS..=BEACON_MAX_INTERVAL_SECS).contains(&mean) {
        return None;
    }

    let variance = intervals.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / intervals.len() as f64;
    let cv = if mean > 0.0 { variance.sqrt() / mean } else { f64::MAX };
    if cv > BEACON_CV_THRESHOLD {
        return None;
    }

    // Cuanto mas parejo el ritmo y mas observaciones lo confirman, mas
    // confianza — un CV muy bajo con pocas muestras podria ser coincidencia.
    let severity = if cv < 0.10 && timestamps.len() >= 10 { "critica" } else { "alta" };
    Some(BeaconVerdict { mean_secs: mean, cv, observations: timestamps.len(), severity })
}

/// Direccion remota real (no local, no comodin) a partir de "host:puerto",
/// version en Rust de la misma regla que ya usa el mapa de red del
/// frontend — dos implementaciones independientes de la misma idea, cada
/// una donde se necesita.
fn remote_host_of(addr: &str) -> Option<String> {
    let host = addr.rsplit_once(':').map(|(h, _)| h).unwrap_or(addr);
    let host = host.trim_matches(['[', ']']);
    if matches!(host, "0.0.0.0" | "*" | "127.0.0.1" | "::" | "::1" | "") {
        None
    } else {
        Some(host.to_string())
    }
}

/// Registra cada conexion establecida hacia un host remoto real — la
/// materia prima que `detect_beacons` analiza. Best-effort: un fallo aca
/// no debe tumbar el resto de la revision.
fn record_connection_history(db: &Db, timestamp: i64) {
    let Ok(connections) = crate::commands::network_details::list_active_connections() else { return };
    let processes = process_table();
    let Ok(conn) = db.0.lock() else { return };

    for c in &connections {
        if !c.state.as_deref().map(|s| s.eq_ignore_ascii_case("ESTABLISHED")).unwrap_or(false) {
            continue;
        }
        let Some(host) = remote_host_of(&c.remote_addr) else { continue };
        let Some(pid) = c.pid else { continue };
        let name = processes.get(&pid).map(|(n, _)| n.clone()).unwrap_or_else(|| "desconocido".to_string());
        let _ = conn.execute(
            "INSERT INTO sentinel_connection_history (timestamp_unix, process_name, pid, remote_host) VALUES (?1, ?2, ?3, ?4)",
            params![timestamp, name, pid, host],
        );
    }
    let _ = conn.execute("DELETE FROM sentinel_connection_history WHERE timestamp_unix < ?1", params![timestamp - CONNECTION_HISTORY_RETENTION_SECS]);
}

/// Agrupa el historial reciente por (proceso, host) y corre el analisis
/// sobre cada grupo. Devuelve solo los que parecen beacons.
fn detect_beacons(db: &Db, now: i64) -> Vec<(String, String, BeaconVerdict)> {
    let Ok(conn) = db.0.lock() else { return Vec::new() };
    let Ok(mut stmt) = conn.prepare(
        "SELECT process_name, remote_host, timestamp_unix FROM sentinel_connection_history
         WHERE timestamp_unix >= ?1 ORDER BY process_name, remote_host",
    ) else {
        return Vec::new();
    };
    let rows: Vec<(String, String, i64)> = stmt
        .query_map(params![now - BEACON_LOOKBACK_SECS], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default();
    drop(stmt);
    drop(conn);

    let mut groups: HashMap<(String, String), Vec<i64>> = HashMap::new();
    for (name, host, ts) in rows {
        groups.entry((name, host)).or_default().push(ts);
    }

    groups.into_iter().filter_map(|((name, host), timestamps)| analyze_beacon(timestamps).map(|v| (name, host, v))).collect()
}

fn load_beacon_cooldowns(db: &Db) -> HashMap<String, i64> {
    let Ok(conn) = db.0.lock() else { return HashMap::new() };
    conn.query_row("SELECT value FROM sentinel_state WHERE key = 'beacon_cooldowns'", [], |row| row.get::<_, String>(0))
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn save_beacon_cooldowns(db: &Db, cooldowns: &HashMap<String, i64>) {
    let Ok(json) = serde_json::to_string(cooldowns) else { return };
    let Ok(conn) = db.0.lock() else { return };
    let _ = conn.execute(
        "INSERT INTO sentinel_state (key, value, updated_at_unix) VALUES ('beacon_cooldowns', ?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_unix = excluded.updated_at_unix",
        params![json, now_unix()],
    );
}

/// Corre el paso completo de beaconing dentro de un tick: registra las
/// conexiones de este momento, analiza el historial acumulado, y levanta
/// (respetando el cooldown) una alerta por cada patron que parezca un
/// canal de C2. Devuelve cuantos eventos y alertas nuevas genero.
fn run_beacon_detection(app: &AppHandle, db: &Db, timestamp: i64) -> (usize, usize) {
    record_connection_history(db, timestamp);
    let hits = detect_beacons(db, timestamp);
    if hits.is_empty() {
        return (0, 0);
    }

    let mut cooldowns = load_beacon_cooldowns(db);
    let mut new_events = 0usize;
    let mut new_alerts = 0usize;

    for (name, host, verdict) in hits {
        let key = format!("{name}->{host}");
        if timestamp - cooldowns.get(&key).copied().unwrap_or(0) < BEACON_REALERT_COOLDOWN_SECS {
            continue;
        }
        cooldowns.insert(key, timestamp);

        let finding = Finding {
            source: "red",
            kind: "beacon-detectado",
            subject: format!("{name} -> {host}"),
            detail: Some(format!("cada ~{:.0}s, variacion {:.0}%, {} conexiones", verdict.mean_secs, verdict.cv * 100.0, verdict.observations)),
            alert: Some(PendingAlert {
                rule_id: "beaconing-c2",
                severity: verdict.severity,
                title: format!("Posible canal de C2: '{name}' habla con {host} a intervalos regulares"),
                detail: format!(
                    "'{name}' se conecto a {host} {} veces en las ultimas horas, en promedio cada {:.0} segundos \
                     con solo un {:.0}% de variacion — un ritmo casi perfectamente regular que el trafico humano \
                     normal no produce. Es la tecnica de beaconing que usan los frameworks de post-explotacion \
                     para reportarse a su servidor de control sin mantener una conexion abierta. Revisa que es \
                     '{host}' y si '{name}' tiene razon para hablar con ese destino todo el tiempo.",
                    verdict.observations, verdict.mean_secs, verdict.cv * 100.0
                ),
                mitre: "T1071 — Protocolo de capa de aplicacion (C2 por beaconing)",
            }),
        };

        match persist_finding(db, &finding, timestamp) {
            Ok((event, alert)) => {
                new_events += 1;
                let _ = app.emit("sentinel://event", event);
                if let Some(alert) = alert {
                    new_alerts += 1;
                    let _ = app.emit("sentinel://alert", alert);
                }
            }
            Err(e) => eprintln!("[kryptos] sentinel no pudo registrar un beacon: {e}"),
        }
    }

    save_beacon_cooldowns(db, &cooldowns);
    (new_events, new_alerts)
}

// ---------------------------------------------------------------------
// Puntaje de postura
// ---------------------------------------------------------------------

/// Convierte el puntaje de la linea base (que tan bien configuradas estan
/// las defensas) y las alertas pendientes (que tan bien va la respuesta a
/// incidentes) en un solo numero de 0 a 100. No reemplaza a ninguno de los
/// dos por separado — los combina para dar el numero que de verdad importa
/// revisar todos los dias: "que tan bien protegido esta este equipo ahora
/// mismo", no solo "esta bien configurado" o "hay alertas".
fn compute_posture_score(baseline_score: u8, pending_by_severity: &HashMap<String, i64>) -> u8 {
    let penalty = pending_by_severity.get("critica").copied().unwrap_or(0) * 15
        + pending_by_severity.get("alta").copied().unwrap_or(0) * 8
        + pending_by_severity.get("media").copied().unwrap_or(0) * 3
        + pending_by_severity.get("baja").copied().unwrap_or(0) * 1;

    (baseline_score as i64 - penalty).clamp(0, 100) as u8
}

// ---------------------------------------------------------------------
// Persistencia de resultados
// ---------------------------------------------------------------------

fn load_snapshot(db: &Db) -> Option<Snapshot> {
    let conn = db.0.lock().ok()?;
    let json: String = conn
        .query_row("SELECT value FROM sentinel_state WHERE key = ?1", params![SNAPSHOT_KEY], |row| row.get(0))
        .ok()?;
    serde_json::from_str(&json).ok()
}

fn save_snapshot(db: &Db, snapshot: &Snapshot) -> Result<(), String> {
    let json = serde_json::to_string(snapshot).map_err(|e| format!("No se pudo serializar la foto del sistema: {e}"))?;
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
    conn.execute(
        "INSERT INTO sentinel_state (key, value, updated_at_unix) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_unix = excluded.updated_at_unix",
        params![SNAPSHOT_KEY, json, now_unix()],
    )
    .map_err(|e| format!("No se pudo guardar la foto del sistema: {e}"))?;
    Ok(())
}

/// Escribe un evento y, si la regla levanto una, la alerta asociada.
/// Devuelve ambos ya con su id real para poder emitirlos al frontend.
fn persist_finding(db: &Db, finding: &Finding, timestamp: i64) -> Result<(SentinelEvent, Option<SentinelAlert>), String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;

    conn.execute(
        "INSERT INTO sentinel_events (timestamp_unix, source, kind, subject, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![timestamp, finding.source, finding.kind, finding.subject, finding.detail],
    )
    .map_err(|e| format!("No se pudo registrar el evento: {e}"))?;
    let event_id = conn.last_insert_rowid();

    let event = SentinelEvent {
        id: event_id,
        timestamp_unix: timestamp,
        source: finding.source.to_string(),
        kind: finding.kind.to_string(),
        subject: finding.subject.clone(),
        detail: finding.detail.clone(),
    };

    let Some(pending) = &finding.alert else { return Ok((event, None)) };

    conn.execute(
        "INSERT INTO sentinel_alerts (timestamp_unix, rule_id, severity, title, detail, event_id, acknowledged, mitre_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
        params![timestamp, pending.rule_id, pending.severity, pending.title, pending.detail, event_id, pending.mitre],
    )
    .map_err(|e| format!("No se pudo registrar la alerta: {e}"))?;

    let alert = SentinelAlert {
        id: conn.last_insert_rowid(),
        timestamp_unix: timestamp,
        rule_id: pending.rule_id.to_string(),
        severity: pending.severity.to_string(),
        title: pending.title.clone(),
        detail: pending.detail.clone(),
        event_id: Some(event_id),
        acknowledged: false,
        mitre_id: Some(pending.mitre.to_string()),
    };
    Ok((event, Some(alert)))
}

// ---------------------------------------------------------------------
// El tick
// ---------------------------------------------------------------------

/// Una pasada completa: fotografiar, comparar, registrar, avisar.
///
/// La primera vez que corre no hay foto anterior contra la cual comparar,
/// asi que guarda la actual como referencia y no levanta ni una alerta.
/// Sin esto, el primer arranque reportaria las ~80 tareas programadas que
/// Windows trae de fabrica como "nuevas", que es exactamente el tipo de
/// ruido que hace que la gente ignore las alertas.
fn run_tick(app: &AppHandle) -> Result<ScanOutcome, String> {
    let db = app.state::<Db>();
    let current = collect_snapshot();
    let timestamp = now_unix();

    let Some(previous) = load_snapshot(&db) else {
        save_snapshot(&db, &current)?;
        let finding = Finding {
            source: "motor",
            kind: "referencia-establecida",
            subject: "Foto inicial del equipo".to_string(),
            detail: Some(format!(
                "{} puertos en escucha, {} elementos de arranque automatico, linea base al {}%",
                current.ports.len(),
                current.persistence.len(),
                current.baseline_score
            )),
            alert: None,
        };
        let (event, _) = persist_finding(&db, &finding, timestamp)?;
        let _ = app.emit("sentinel://event", event);
        // El beaconing corre desde la primera pasada tambien: no depende de
        // una foto anterior, depende de historial propio que empieza a
        // acumularse desde ahora — no tiene sentido esperar a la segunda
        // revision para empezar a mirarlo.
        let (beacon_events, beacon_alerts) = run_beacon_detection(app, &db, timestamp);
        return Ok(ScanOutcome { new_events: 1 + beacon_events, new_alerts: beacon_alerts, baseline_established: true });
    };

    let mut findings = evaluate(&previous, &current);
    if let Some(chain) = detect_behavior_chain(&findings) {
        findings.push(chain);
    }
    let mut new_alerts = 0usize;

    for finding in &findings {
        match persist_finding(&db, finding, timestamp) {
            Ok((event, alert)) => {
                let _ = app.emit("sentinel://event", event);
                if let Some(alert) = alert {
                    new_alerts += 1;
                    let _ = app.emit("sentinel://alert", alert);
                }
            }
            Err(e) => eprintln!("[kryptos] sentinel no pudo registrar un hallazgo: {e}"),
        }
    }

    let (beacon_events, beacon_alerts) = run_beacon_detection(app, &db, timestamp);

    save_snapshot(&db, &current)?;
    Ok(ScanOutcome { new_events: findings.len() + beacon_events, new_alerts: new_alerts + beacon_alerts, baseline_established: false })
}

// ---------------------------------------------------------------------
// Estado del motor
// ---------------------------------------------------------------------

/// El hilo de vigilancia y su configuracion. `running` es la unica senal de
/// parada: el hilo la consulta cada segundo, asi que detenerlo tarda como
/// maximo un segundo aunque el intervalo sea de diez minutos.
pub struct SentinelManager {
    running: Arc<AtomicBool>,
    interval_secs: Mutex<u64>,
    last_run_unix: Arc<Mutex<i64>>,
}

impl Default for SentinelManager {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            interval_secs: Mutex::new(DEFAULT_INTERVAL_SECS),
            last_run_unix: Arc::new(Mutex::new(0)),
        }
    }
}

/// Arranca la vigilancia continua. Corre una pasada de inmediato y despues
/// cada `interval_secs`.
#[tauri::command]
pub fn sentinel_start(app: AppHandle, manager: State<'_, SentinelManager>, interval_secs: Option<u64>) -> Result<(), String> {
    if manager.running.load(Ordering::SeqCst) {
        return Err("La vigilancia ya esta activa.".into());
    }

    let interval = interval_secs.unwrap_or(DEFAULT_INTERVAL_SECS).max(MIN_INTERVAL_SECS);
    *manager.interval_secs.lock().map_err(|_| "Estado del motor bloqueado.".to_string())? = interval;
    manager.running.store(true, Ordering::SeqCst);

    let running = Arc::clone(&manager.running);
    let last_run = Arc::clone(&manager.last_run_unix);
    let app_handle = app.clone();

    std::thread::spawn(move || {
        while running.load(Ordering::SeqCst) {
            match run_tick(&app_handle) {
                Ok(outcome) => {
                    if let Ok(mut slot) = last_run.lock() {
                        *slot = now_unix();
                    }
                    let _ = app_handle.emit("sentinel://tick", outcome);
                }
                Err(e) => eprintln!("[kryptos] sentinel fallo una pasada: {e}"),
            }

            // Dormir en tramos de un segundo en vez de uno largo: asi
            // `sentinel_stop` corta de inmediato en lugar de esperar a que
            // termine el intervalo completo.
            for _ in 0..interval {
                if !running.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(Duration::from_secs(1));
            }
        }
    });

    record_audit_event(
        &app.state::<Db>(),
        "Vigilancia continua iniciada",
        "Sentinel",
        "exito",
        Some(&format!("Intervalo de {interval} segundos")),
    );
    Ok(())
}

#[tauri::command]
pub fn sentinel_stop(app: AppHandle, manager: State<'_, SentinelManager>) -> Result<(), String> {
    manager.running.store(false, Ordering::SeqCst);
    record_audit_event(&app.state::<Db>(), "Vigilancia continua detenida", "Sentinel", "exito", None);
    Ok(())
}

/// Una sola pasada manual, sin activar la vigilancia continua. Util para
/// revisar el equipo en el momento sin dejar el hilo corriendo.
#[tauri::command]
pub fn sentinel_scan_now(app: AppHandle, manager: State<'_, SentinelManager>) -> Result<ScanOutcome, String> {
    let outcome = run_tick(&app)?;
    if let Ok(mut slot) = manager.last_run_unix.lock() {
        *slot = now_unix();
    }
    Ok(outcome)
}

#[tauri::command]
pub fn sentinel_status(db: State<'_, Db>, manager: State<'_, SentinelManager>) -> Result<SentinelStatus, String> {
    let snapshot = load_snapshot(&db);
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;

    let count = |sql: &str| -> i64 { conn.query_row(sql, [], |row| row.get(0)).unwrap_or(0) };

    let mut pending_by_severity: HashMap<String, i64> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT severity, COUNT(*) FROM sentinel_alerts WHERE acknowledged = 0 GROUP BY severity") {
        if let Ok(rows) = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))) {
            for row in rows.flatten() {
                pending_by_severity.insert(row.0, row.1);
            }
        }
    }
    let baseline_score = snapshot.as_ref().map(|s| s.baseline_score).unwrap_or(0);

    Ok(SentinelStatus {
        running: manager.running.load(Ordering::SeqCst),
        interval_secs: *manager.interval_secs.lock().map_err(|_| "Estado del motor bloqueado.".to_string())?,
        last_run_unix: *manager.last_run_unix.lock().map_err(|_| "Estado del motor bloqueado.".to_string())?,
        has_baseline: snapshot.is_some(),
        event_count: count("SELECT COUNT(*) FROM sentinel_events"),
        alert_count: count("SELECT COUNT(*) FROM sentinel_alerts"),
        unacknowledged_count: count("SELECT COUNT(*) FROM sentinel_alerts WHERE acknowledged = 0"),
        watched_ports: snapshot.as_ref().map(|s| s.ports.len()).unwrap_or(0),
        watched_persistence: snapshot.as_ref().map(|s| s.persistence.len()).unwrap_or(0),
        posture_score: compute_posture_score(baseline_score, &pending_by_severity),
    })
}

/// La linea de tiempo unificada. `source` filtra por origen ("red",
/// "persistencia", "linea-base", "motor").
#[tauri::command]
pub fn sentinel_list_events(db: State<'_, Db>, limit: Option<u32>, source: Option<String>) -> Result<Vec<SentinelEvent>, String> {
    let limit = limit.unwrap_or(200).min(2000);
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;

    let sql = "SELECT id, timestamp_unix, source, kind, subject, detail FROM sentinel_events
               WHERE (?1 IS NULL OR source = ?1) ORDER BY timestamp_unix DESC, id DESC LIMIT ?2";
    let mut stmt = conn.prepare(sql).map_err(|e| format!("No se pudo consultar la linea de tiempo: {e}"))?;

    let rows = stmt
        .query_map(params![source, limit], |row| {
            Ok(SentinelEvent {
                id: row.get(0)?,
                timestamp_unix: row.get(1)?,
                source: row.get(2)?,
                kind: row.get(3)?,
                subject: row.get(4)?,
                detail: row.get(5)?,
            })
        })
        .map_err(|e| format!("No se pudo leer la linea de tiempo: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer un evento: {e}"))
}

#[tauri::command]
pub fn sentinel_list_alerts(db: State<'_, Db>, limit: Option<u32>, only_pending: Option<bool>) -> Result<Vec<SentinelAlert>, String> {
    let limit = limit.unwrap_or(200).min(2000);
    let only_pending = only_pending.unwrap_or(false);
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;

    let sql = "SELECT id, timestamp_unix, rule_id, severity, title, detail, event_id, acknowledged, mitre_id
               FROM sentinel_alerts WHERE (?1 = 0 OR acknowledged = 0)
               ORDER BY timestamp_unix DESC, id DESC LIMIT ?2";
    let mut stmt = conn.prepare(sql).map_err(|e| format!("No se pudieron consultar las alertas: {e}"))?;

    let rows = stmt
        .query_map(params![only_pending as i64, limit], |row| {
            Ok(SentinelAlert {
                id: row.get(0)?,
                timestamp_unix: row.get(1)?,
                rule_id: row.get(2)?,
                severity: row.get(3)?,
                title: row.get(4)?,
                detail: row.get(5)?,
                event_id: row.get(6)?,
                acknowledged: row.get::<_, i64>(7)? != 0,
                mitre_id: row.get(8)?,
            })
        })
        .map_err(|e| format!("No se pudieron leer las alertas: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("No se pudo leer una alerta: {e}"))
}

/// Marca una alerta como revisada. No la borra: el registro de que existio
/// y de que alguien la atendio es justamente lo que hace util un historial.
#[tauri::command]
pub fn sentinel_acknowledge_alert(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
    conn.execute("UPDATE sentinel_alerts SET acknowledged = 1 WHERE id = ?1", params![id])
        .map_err(|e| format!("No se pudo marcar la alerta: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn sentinel_acknowledge_all(db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
    conn.execute("UPDATE sentinel_alerts SET acknowledged = 1 WHERE acknowledged = 0", [])
        .map_err(|e| format!("No se pudieron marcar las alertas: {e}"))?;
    Ok(())
}

/// Descarta la foto de referencia. La siguiente pasada vuelve a tomar el
/// estado actual como punto de partida — util despues de instalar software
/// a proposito, para no seguir arrastrando alertas de algo ya revisado.
#[tauri::command]
pub fn sentinel_reset_reference(app: AppHandle, db: State<'_, Db>) -> Result<(), String> {
    {
        let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
        conn.execute("DELETE FROM sentinel_state WHERE key = ?1", params![SNAPSHOT_KEY])
            .map_err(|e| format!("No se pudo descartar la referencia: {e}"))?;
    }
    record_audit_event(&app.state::<Db>(), "Referencia de vigilancia reiniciada", "Sentinel", "exito", None);
    Ok(())
}

/// Borra la linea de tiempo y las alertas. El frontend confirma antes.
#[tauri::command]
pub fn sentinel_clear_history(app: AppHandle, db: State<'_, Db>) -> Result<(), String> {
    {
        let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
        conn.execute_batch("DELETE FROM sentinel_events; DELETE FROM sentinel_alerts;")
            .map_err(|e| format!("No se pudo limpiar el historial: {e}"))?;
    }
    record_audit_event(&app.state::<Db>(), "Historial de vigilancia borrado", "Sentinel", "exito", None);
    Ok(())
}

#[derive(Serialize)]
pub struct SentinelExport {
    pub json: String,
    pub sha256: String,
    pub event_count: usize,
    pub alert_count: usize,
    pub exported_at_unix: i64,
}

/// Exporta toda la linea de tiempo y las alertas de Sentinel, firmadas con
/// el mismo esquema SHA-256 que el historial de auditoria — util como
/// evidencia si hay que reportar un incidente: cualquiera puede re-hashear
/// el archivo despues y confirmar que nadie lo edito tras exportarlo.
#[tauri::command]
pub fn sentinel_export(db: State<'_, Db>) -> Result<SentinelExport, String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;

    let mut events_stmt = conn
        .prepare("SELECT id, timestamp_unix, source, kind, subject, detail FROM sentinel_events ORDER BY timestamp_unix ASC")
        .map_err(|e| format!("No se pudo consultar la linea de tiempo: {e}"))?;
    let events: Vec<SentinelEvent> = events_stmt
        .query_map([], |row| {
            Ok(SentinelEvent {
                id: row.get(0)?,
                timestamp_unix: row.get(1)?,
                source: row.get(2)?,
                kind: row.get(3)?,
                subject: row.get(4)?,
                detail: row.get(5)?,
            })
        })
        .map_err(|e| format!("No se pudo leer la linea de tiempo: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("No se pudo leer un evento: {e}"))?;
    drop(events_stmt);

    let mut alerts_stmt = conn
        .prepare(
            "SELECT id, timestamp_unix, rule_id, severity, title, detail, event_id, acknowledged, mitre_id
             FROM sentinel_alerts ORDER BY timestamp_unix ASC",
        )
        .map_err(|e| format!("No se pudieron consultar las alertas: {e}"))?;
    let alerts: Vec<SentinelAlert> = alerts_stmt
        .query_map([], |row| {
            Ok(SentinelAlert {
                id: row.get(0)?,
                timestamp_unix: row.get(1)?,
                rule_id: row.get(2)?,
                severity: row.get(3)?,
                title: row.get(4)?,
                detail: row.get(5)?,
                event_id: row.get(6)?,
                acknowledged: row.get::<_, i64>(7)? != 0,
                mitre_id: row.get(8)?,
            })
        })
        .map_err(|e| format!("No se pudieron leer las alertas: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("No se pudo leer una alerta: {e}"))?;
    drop(alerts_stmt);
    drop(conn);

    #[derive(Serialize)]
    struct ExportBody {
        events: Vec<SentinelEvent>,
        alerts: Vec<SentinelAlert>,
    }
    let event_count = events.len();
    let alert_count = alerts.len();
    let json = serde_json::to_string_pretty(&ExportBody { events, alerts }).map_err(|e| format!("No se pudo generar el export: {e}"))?;

    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    let sha256 = format!("{:x}", hasher.finalize());

    Ok(SentinelExport { event_count, alert_count, json, sha256, exported_at_unix: now_unix() })
}

// ---------------------------------------------------------------------
// Maquina del tiempo: reconstruir el estado del equipo en un momento pasado
// ---------------------------------------------------------------------
//
// Sentinel no guarda una foto por cada tick — solo la mas reciente, en
// `sentinel_state`. Pero cada cambio que esa foto tuvo en su historia ya
// quedo escrito, uno por uno, en `sentinel_events`. Eso es suficiente para
// reconstruir el estado exacto en cualquier momento pasado: se recorren
// los eventos en orden desde el principio hasta el instante pedido y se
// va aplicando cada uno, igual que reproducir un log de transacciones.
// No hace falta guardar snapshots completos — la propia linea de tiempo
// que ya existia es la maquina del tiempo.

#[derive(Serialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

#[derive(Serialize)]
pub struct ReconstructedState {
    pub as_of_unix: i64,
    pub ports: Vec<KeyValue>,
    pub persistence: Vec<KeyValue>,
    /// nombre del chequeo -> "ok" | "warning" (solo incluye chequeos que
    /// cambiaron de estado al menos una vez antes de `as_of_unix`).
    pub baseline: Vec<KeyValue>,
    pub baseline_score: Option<u8>,
    pub events_replayed: usize,
}

#[derive(Serialize)]
pub struct SentinelTimeBounds {
    pub earliest_unix: Option<i64>,
    pub latest_unix: Option<i64>,
}

/// El rango de tiempo que la maquina del tiempo puede reconstruir — desde
/// el primer evento que Sentinel registro hasta el mas reciente. El
/// frontend usa esto para acotar el control deslizante antes de pedir
/// ninguna reconstruccion.
#[tauri::command]
pub fn sentinel_time_bounds(db: State<'_, Db>) -> Result<SentinelTimeBounds, String> {
    let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
    let (earliest_unix, latest_unix) = conn
        .query_row("SELECT MIN(timestamp_unix), MAX(timestamp_unix) FROM sentinel_events", [], |row| {
            Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?))
        })
        .map_err(|e| format!("No se pudo consultar el rango de tiempo: {e}"))?;
    Ok(SentinelTimeBounds { earliest_unix, latest_unix })
}

/// Reconstruye el estado del equipo tal como Sentinel lo veia en
/// `as_of_unix`, reproduciendo la linea de tiempo desde el principio hasta
/// ese instante. Solo lectura — nunca toca el estado real ni el actual.
#[tauri::command]
pub fn sentinel_state_at(db: State<'_, Db>, as_of_unix: i64) -> Result<ReconstructedState, String> {
    let rows: Vec<(String, String, Option<String>)> = {
        let conn = db.0.lock().map_err(|_| "No se pudo acceder a la base de datos local.".to_string())?;
        let mut stmt = conn
            .prepare("SELECT kind, subject, detail FROM sentinel_events WHERE timestamp_unix <= ?1 ORDER BY timestamp_unix ASC, id ASC")
            .map_err(|e| format!("No se pudo consultar la linea de tiempo: {e}"))?;
        let collected = stmt
            .query_map(params![as_of_unix], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| format!("No se pudo leer la linea de tiempo: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("No se pudo leer un evento: {e}"))?;
        collected
    };

    Ok(replay_events(rows, as_of_unix))
}

/// El motor puro de la reconstruccion, separado de la consulta SQL para
/// poder probarlo sin una base de datos real.
fn replay_events(rows: Vec<(String, String, Option<String>)>, as_of_unix: i64) -> ReconstructedState {
    let mut ports: HashMap<String, String> = HashMap::new();
    let mut persistence: HashMap<String, String> = HashMap::new();
    let mut baseline: HashMap<String, String> = HashMap::new();
    let mut baseline_score: Option<u8> = None;
    let events_replayed = rows.len();

    for (kind, subject, detail) in rows {
        match kind.as_str() {
            "puerto-escucha-nuevo" => {
                ports.insert(subject, detail.unwrap_or_default());
            }
            "puerto-escucha-cerrado" => {
                ports.remove(&subject);
            }
            "persistencia-nueva" => {
                persistence.insert(subject, detail.unwrap_or_default());
            }
            "persistencia-eliminada" => {
                persistence.remove(&subject);
            }
            "defensa-desactivada" | "defensa-restaurada" | "defensa-cambiada" => {
                // El detalle tiene la forma "antes -> despues"; solo el
                // estado final importa para reconstruir el momento.
                if let Some(after) = detail.as_deref().and_then(|d| d.split(" -> ").nth(1)) {
                    baseline.insert(subject, after.to_string());
                }
            }
            "puntaje-cambiado" => {
                if let Some(after) = subject.split(" -> ").nth(1) {
                    baseline_score = after.trim_end_matches('%').parse::<u8>().ok();
                }
            }
            _ => {}
        }
    }

    ReconstructedState {
        as_of_unix,
        ports: ports.into_iter().map(|(key, value)| KeyValue { key, value }).collect(),
        persistence: persistence.into_iter().map(|(key, value)| KeyValue { key, value }).collect(),
        baseline: baseline.into_iter().map(|(key, value)| KeyValue { key, value }).collect(),
        baseline_score,
        events_replayed,
    }
}

#[cfg(test)]
mod time_machine_tests {
    use super::*;

    fn row(kind: &str, subject: &str, detail: Option<&str>) -> (String, String, Option<String>) {
        (kind.to_string(), subject.to_string(), detail.map(|d| d.to_string()))
    }

    #[test]
    fn a_port_that_opened_and_never_closed_is_present_at_a_later_instant() {
        let rows = vec![row("puerto-escucha-nuevo", "TCP 0.0.0.0:445", Some("svchost.exe"))];
        let state = replay_events(rows, 9_999_999_999);
        assert_eq!(state.ports.len(), 1);
        assert_eq!(state.ports[0].key, "TCP 0.0.0.0:445");
    }

    #[test]
    fn a_port_that_later_closed_is_absent_after_that_point_but_present_before() {
        let rows = vec![
            row("puerto-escucha-nuevo", "TCP 0.0.0.0:445", Some("svchost.exe")),
            row("puerto-escucha-cerrado", "TCP 0.0.0.0:445", None),
        ];
        // Reproducido completo (despues del cierre): el puerto ya no esta.
        assert!(replay_events(rows.clone(), 9_999_999_999).ports.is_empty());
        // Reproducido solo hasta el primer evento (timestamps no importan
        // aca, se prueba pasando un subconjunto de filas): el puerto seguia abierto.
        assert_eq!(replay_events(rows[..1].to_vec(), 9_999_999_999).ports.len(), 1);
    }

    #[test]
    fn defense_state_reconstructs_to_the_latest_recorded_status() {
        let rows = vec![
            row("defensa-desactivada", "Firewall", Some("ok -> warning")),
            row("defensa-restaurada", "Firewall", Some("warning -> ok")),
        ];
        let state = replay_events(rows, 9_999_999_999);
        assert_eq!(state.baseline.len(), 1);
        assert_eq!(state.baseline[0].value, "ok");
    }

    #[test]
    fn posture_score_reconstructs_to_the_latest_recorded_value() {
        let rows = vec![row("puntaje-cambiado", "80% -> 65%", None), row("puntaje-cambiado", "65% -> 90%", None)];
        let state = replay_events(rows, 9_999_999_999);
        assert_eq!(state.baseline_score, Some(90));
    }

    #[test]
    fn an_empty_timeline_reconstructs_to_an_empty_state() {
        let state = replay_events(vec![], 123);
        assert!(state.ports.is_empty() && state.persistence.is_empty() && state.baseline.is_empty());
        assert_eq!(state.baseline_score, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn port(exe: Option<&str>, exposed: bool) -> PortEntry {
        PortEntry {
            process_name: "algo.exe".to_string(),
            exe_path: exe.map(|e| e.to_string()),
            pid: Some(1234),
            exposed,
        }
    }

    fn snapshot_with_port(key: &str, entry: PortEntry) -> Snapshot {
        let mut snap = Snapshot::default();
        snap.ports.insert(key.to_string(), entry);
        snap
    }

    fn severities(findings: &[Finding]) -> Vec<&str> {
        findings.iter().filter_map(|f| f.alert.as_ref()).map(|a| a.severity).collect()
    }

    #[test]
    fn exposed_addresses_are_told_apart_from_localhost() {
        assert!(is_exposed("0.0.0.0:445"));
        assert!(is_exposed("[::]:445"));
        assert!(is_exposed("*:445"));
        assert!(!is_exposed("127.0.0.1:8080"));
        assert!(!is_exposed("192.168.1.10:3000"));
        assert!(!is_exposed("[::1]:8080"));
    }

    #[test]
    fn drop_locations_are_recognised_case_insensitively() {
        assert!(suspicious_location(r"C:\Users\ana\AppData\Local\Temp\x.exe").is_some());
        assert!(suspicious_location(r"C:\USERS\ANA\DOWNLOADS\SETUP.EXE").is_some());
        assert!(suspicious_location("/tmp/payload").is_some());
        // Software instalado normalmente: no debe subir la severidad de nada.
        assert!(suspicious_location(r"C:\Program Files\App\app.exe").is_none());
        assert!(suspicious_location("/usr/bin/sshd").is_none());
    }

    #[test]
    fn an_unchanged_machine_produces_nothing() {
        let snap = snapshot_with_port("TCP 0.0.0.0:445", port(Some(r"C:\Windows\System32\svc.exe"), true));
        assert!(evaluate(&snap, &snap.clone()).is_empty());
    }

    #[test]
    fn severity_of_a_new_port_follows_exposure_and_location() {
        let empty = Snapshot::default();

        let local = snapshot_with_port("TCP 127.0.0.1:9000", port(Some(r"C:\Program Files\App\app.exe"), false));
        assert_eq!(severities(&evaluate(&empty, &local)), vec!["baja"]);

        let exposed = snapshot_with_port("TCP 0.0.0.0:9000", port(Some(r"C:\Program Files\App\app.exe"), true));
        assert_eq!(severities(&evaluate(&empty, &exposed)), vec!["alta"]);

        // La ubicacion manda sobre la exposicion: un binario en Temp escuchando
        // aunque sea solo en localhost es la senal mas fuerte de las tres.
        let from_temp = snapshot_with_port("TCP 127.0.0.1:9000", port(Some(r"C:\Users\ana\AppData\Local\Temp\x.exe"), false));
        assert_eq!(severities(&evaluate(&empty, &from_temp)), vec!["critica"]);
    }

    #[test]
    fn closing_a_port_is_recorded_but_never_alerts() {
        let before = snapshot_with_port("TCP 0.0.0.0:445", port(None, true));
        let findings = evaluate(&before, &Snapshot::default());
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, "puerto-escucha-cerrado");
        assert!(findings[0].alert.is_none());
    }

    #[test]
    fn a_defence_turning_off_is_critical_but_turning_on_is_silent() {
        let mut before = Snapshot::default();
        before.baseline.insert("Firewall".to_string(), "ok".to_string());
        let mut after = before.clone();
        after.baseline.insert("Firewall".to_string(), "warning".to_string());

        let findings = evaluate(&before, &after);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, "defensa-desactivada");
        assert_eq!(severities(&findings), vec!["critica"]);

        // Y al revés: recuperar una defensa no debe molestar a nadie.
        let restored = evaluate(&after, &before);
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].kind, "defensa-restaurada");
        assert!(restored[0].alert.is_none());
    }

    #[test]
    fn new_persistence_is_high_and_rises_to_critical_from_a_drop_location() {
        let empty = Snapshot::default();
        let mut normal = Snapshot::default();
        normal.persistence.insert(
            "Tareas programadas::Update".to_string(),
            PersistEntry {
                name: "Update".to_string(),
                source: "Tareas programadas".to_string(),
                command: r"C:\Program Files\App\update.exe".to_string(),
            },
        );
        assert_eq!(severities(&evaluate(&empty, &normal)), vec!["alta"]);

        let mut shady = Snapshot::default();
        shady.persistence.insert(
            "Tareas programadas::Rare".to_string(),
            PersistEntry {
                name: "Rare".to_string(),
                source: "Tareas programadas".to_string(),
                command: r"C:\Users\ana\AppData\Local\Temp\dropper.exe".to_string(),
            },
        );
        assert_eq!(severities(&evaluate(&empty, &shady)), vec!["critica"]);
    }

    /// Valida el camino real de recoleccion contra este equipo: que el
    /// parseo de netstat/ss produzca puertos y que sepamos quien los abrio.
    /// Si esto falla, el motor estaria comparando dos conjuntos vacios y
    /// jamas alertaria de nada.
    #[test]
    fn collects_real_listening_ports_from_this_machine() {
        let ports = collect_ports();
        assert!(!ports.is_empty(), "ningun puerto en escucha: el parseo de conexiones no esta funcionando");
        let identified = ports.values().filter(|p| p.process_name != "desconocido").count();
        assert!(identified > 0, "ningun puerto pudo asociarse a un proceso: la tabla de PIDs no esta funcionando");
    }

    /// La otra fuente real: si el listado de arranque automatico saliera
    /// vacio, las alertas de persistencia — las mas valiosas del motor —
    /// nunca se dispararian y nadie lo notaria.
    #[test]
    fn collects_real_persistence_items_from_this_machine() {
        let items = collect_persistence();
        assert!(!items.is_empty(), "ningun elemento de arranque automatico: el listado de tareas no esta funcionando");
        assert!(items.values().all(|i| !i.name.is_empty()), "hay elementos sin nombre: el parseo esta produciendo filas vacias");
    }

    fn lineage(parent: &str, child: &str, exe: Option<&str>) -> LineageEntry {
        LineageEntry { parent_name: parent.to_string(), child_name: child.to_string(), child_pid: 4321, child_exe: exe.map(|e| e.to_string()) }
    }

    #[test]
    fn office_or_a_browser_spawning_a_shell_is_flagged_critical() {
        let empty = Snapshot::default();
        let mut compromised = Snapshot::default();
        compromised.lineage.insert("4321:1000".to_string(), lineage("winword.exe", "powershell.exe", Some(r"C:\Windows\System32\powershell.exe")));

        let findings = evaluate(&empty, &compromised);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, "linaje-sospechoso");
        assert_eq!(findings[0].alert.as_ref().unwrap().severity, "critica");
    }

    #[test]
    fn a_shell_opened_by_something_ordinary_is_not_flagged() {
        // El propio usuario abriendo PowerShell desde el explorador de
        // Windows, o un desarrollador abriendolo desde la Terminal de
        // KRYPTOS, no debe generar ruido — solo importa cuando el padre
        // es uno de los programas de la lista de riesgo.
        let empty = Snapshot::default();
        let mut normal = Snapshot::default();
        normal.lineage.clear();
        // No hay entrada porque collect_lineage() nunca la habria generado
        // para un padre fuera de HIGH_RISK_PARENTS — se prueba la ausencia
        // directamente comprobando que evaluate() no inventa nada de la nada.
        assert!(evaluate(&empty, &normal).is_empty());
    }

    #[test]
    fn a_shell_that_already_existed_is_not_reported_again() {
        let mut snap = Snapshot::default();
        snap.lineage.insert("4321:1000".to_string(), lineage("chrome.exe", "cmd.exe", None));
        assert!(evaluate(&snap, &snap.clone()).is_empty());
    }

    #[test]
    fn simultaneous_new_port_and_persistence_raises_a_critical_chain_alert() {
        let empty = Snapshot::default();
        let mut compromised = Snapshot::default();
        compromised.ports.insert("TCP 0.0.0.0:4444".to_string(), port(Some(r"C:\Users\ana\AppData\Local\Temp\x.exe"), true));
        compromised.persistence.insert(
            "Tareas programadas::Sync".to_string(),
            PersistEntry { name: "Sync".to_string(), source: "Tareas programadas".to_string(), command: r"C:\Users\ana\AppData\Local\Temp\x.exe".to_string() },
        );

        let findings = evaluate(&empty, &compromised);
        let chain = detect_behavior_chain(&findings).expect("deberia detectar el patron combinado");
        assert_eq!(chain.alert.unwrap().severity, "critica");
    }

    #[test]
    fn a_lone_new_port_or_a_lone_new_task_never_raises_a_chain_alert() {
        let empty = Snapshot::default();

        let only_port = snapshot_with_port("TCP 0.0.0.0:4444", port(None, true));
        assert!(detect_behavior_chain(&evaluate(&empty, &only_port)).is_none());

        let mut only_persistence = Snapshot::default();
        only_persistence.persistence.insert(
            "Tareas programadas::Sync".to_string(),
            PersistEntry { name: "Sync".to_string(), source: "Tareas programadas".to_string(), command: "app.exe".to_string() },
        );
        assert!(detect_behavior_chain(&evaluate(&empty, &only_persistence)).is_none());
    }

    #[test]
    fn posture_score_starts_from_the_baseline_and_is_docked_by_pending_alerts() {
        let mut none_pending = HashMap::new();
        assert_eq!(compute_posture_score(90, &none_pending), 90);

        none_pending.insert("critica".to_string(), 1);
        assert_eq!(compute_posture_score(90, &none_pending), 75);

        let mut heavy = HashMap::new();
        heavy.insert("critica".to_string(), 3);
        heavy.insert("alta".to_string(), 2);
        // 100 - 3*15 - 2*8 = 39
        assert_eq!(compute_posture_score(100, &heavy), 39);
    }

    #[test]
    fn posture_score_never_goes_below_zero_or_above_the_baseline() {
        let mut extreme = HashMap::new();
        extreme.insert("critica".to_string(), 50);
        assert_eq!(compute_posture_score(100, &extreme), 0);
        assert_eq!(compute_posture_score(0, &HashMap::new()), 0);
    }

    /// No se puede afirmar que este equipo tenga (o no) un shell
    /// sospechoso corriendo en este instante, asi que esta prueba no
    /// verifica el contenido — verifica que recorrer la tabla de procesos
    /// real y cruzar padres/hijos no truena, y que si algo aparece, tiene
    /// los campos minimos poblados.
    #[test]
    fn collecting_real_process_lineage_does_not_panic_and_is_well_formed() {
        let found = collect_lineage();
        assert!(found.values().all(|e| !e.parent_name.is_empty() && !e.child_name.is_empty()));
    }

    /// Igual que con el linaje: no se puede afirmar que haya (o no) un USB
    /// conectado ahora mismo, asi que solo se verifica que recorrer el
    /// registro/lsusb real no truena y que las filas, si aparecen, tienen
    /// forma valida.
    #[test]
    fn collecting_real_usb_devices_does_not_panic_and_is_well_formed() {
        let found = collect_usb_devices();
        assert!(found.keys().all(|k| !k.is_empty()));
    }

    #[test]
    fn collecting_real_hollow_suspects_does_not_panic_and_is_well_formed() {
        let found = collect_hollow_suspects();
        assert!(found.values().all(|e| !e.process_name.is_empty() && (e.reason == "ejecutable_eliminado" || e.reason == "ubicacion_falsificada")));
    }

    // --- USB ------------------------------------------------------------

    #[test]
    fn a_new_usb_device_raises_a_high_severity_alert() {
        let empty = Snapshot::default();
        let mut with_usb = Snapshot::default();
        with_usb.usb_devices.insert("SERIAL123".to_string(), "Kingston DataTraveler".to_string());

        let findings = evaluate(&empty, &with_usb);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, "usb-nuevo");
        assert_eq!(findings[0].alert.as_ref().unwrap().severity, "alta");
    }

    #[test]
    fn a_usb_device_seen_before_is_not_reported_again() {
        let mut snap = Snapshot::default();
        snap.usb_devices.insert("SERIAL123".to_string(), "Kingston DataTraveler".to_string());
        assert!(evaluate(&snap, &snap.clone()).is_empty());
    }

    // --- Process hollowing / masquerading --------------------------------

    fn hollow(name: &str, reason: &str) -> HollowEntry {
        HollowEntry { process_name: name.to_string(), pid: 777, exe_path: Some(r"C:\Users\ana\Downloads\svchost.exe".to_string()), reason: reason.to_string() }
    }

    #[test]
    fn a_faked_system_process_location_is_critical() {
        let empty = Snapshot::default();
        let mut suspicious = Snapshot::default();
        suspicious.hollow_suspects.insert("777:1000".to_string(), hollow("svchost.exe", "ubicacion_falsificada"));

        let findings = evaluate(&empty, &suspicious);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].alert.as_ref().unwrap().severity, "critica");
    }

    #[test]
    fn a_deleted_executable_still_running_is_high_not_critical() {
        let empty = Snapshot::default();
        let mut suspicious = Snapshot::default();
        suspicious.hollow_suspects.insert("777:1000".to_string(), hollow("updater.exe", "ejecutable_eliminado"));

        let findings = evaluate(&empty, &suspicious);
        assert_eq!(findings[0].alert.as_ref().unwrap().severity, "alta");
    }

    #[test]
    fn a_hollow_suspect_already_known_is_not_reported_again() {
        let mut snap = Snapshot::default();
        snap.hollow_suspects.insert("777:1000".to_string(), hollow("svchost.exe", "ubicacion_falsificada"));
        assert!(evaluate(&snap, &snap.clone()).is_empty());
    }

    // --- Beaconing (C2) ---------------------------------------------------

    #[test]
    fn a_perfectly_regular_rhythm_is_flagged_as_a_beacon() {
        // Conexiones cada exactamente 60 segundos, 12 veces — el patron de
        // libro de texto de un implante con temporizador fijo.
        let timestamps: Vec<i64> = (0..12).map(|i| i * 60).collect();
        let verdict = analyze_beacon(timestamps).expect("un ritmo perfecto debe detectarse");
        assert_eq!(verdict.severity, "critica");
        assert!(verdict.cv < 0.01);
    }

    #[test]
    fn human_like_irregular_traffic_is_not_flagged() {
        // Intervalos bien dispersos — nada de trafico humano real cae en
        // un CV tan bajo como el que exige la regla.
        let timestamps = vec![0, 12, 340, 341, 900, 4500, 4510, 20000, 20500];
        assert!(analyze_beacon(timestamps).is_none());
    }

    #[test]
    fn too_few_observations_never_triggers_even_if_regular() {
        let timestamps: Vec<i64> = (0..4).map(|i| i * 60).collect();
        assert!(analyze_beacon(timestamps).is_none());
    }

    #[test]
    fn a_rhythm_outside_the_beacon_range_is_ignored() {
        // Cada 2 segundos: demasiado rapido, tipico de trafico interactivo,
        // no de un temporizador de beacon.
        let too_fast: Vec<i64> = (0..10).map(|i| i * 2).collect();
        assert!(analyze_beacon(too_fast).is_none());

        // Cada 2 horas: fuera del rango que la regla considera beaconing.
        let too_slow: Vec<i64> = (0..8).map(|i| i * 7200).collect();
        assert!(analyze_beacon(too_slow).is_none());
    }

    #[test]
    fn remote_host_extraction_matches_the_frontends_notion_of_remote() {
        assert_eq!(remote_host_of("93.184.216.34:443"), Some("93.184.216.34".to_string()));
        assert_eq!(remote_host_of("[2606:2800:220:1::1]:443"), Some("2606:2800:220:1::1".to_string()));
        assert_eq!(remote_host_of("127.0.0.1:8080"), None);
        assert_eq!(remote_host_of("0.0.0.0:445"), None);
    }

    /// La primera foto es la que decide si el motor es usable: si arrancara
    /// alertando de todo lo que ya estaba instalado, el usuario apagaria
    /// Sentinel el primer dia. Comparar una foto real contra si misma debe
    /// dar exactamente cero hallazgos.
    #[test]
    fn a_real_snapshot_compared_against_itself_is_silent() {
        let snap = collect_snapshot();
        assert!(
            evaluate(&snap, &snap.clone()).is_empty(),
            "el motor reporta cambios donde no los hay: produciria ruido constante"
        );
    }
}
