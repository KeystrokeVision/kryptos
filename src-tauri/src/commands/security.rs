use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

/// Hard cap on files hashed in a single directory scan. This is a defensive
/// GUI, not a batch tool — a runaway scan of e.g. `C:\` would block the UI
/// for minutes; we scan up to this many files and report `truncated: true`
/// rather than hang.
const MAX_FILES_PER_SCAN: usize = 20_000;

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ---------------------------------------------------------------------
// Integridad de archivos (FIM ligero): hash, línea base, comparación
// ---------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct FileHashEntry {
    pub path: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub modified_unix: u64,
}

#[derive(Serialize)]
pub struct DirectoryHashResult {
    pub entries: Vec<FileHashEntry>,
    pub truncated: bool,
}

/// `pub(crate)` (no solo `fn`) porque el dossier de proceso en
/// `dossier.rs` reutiliza este mismo hasheo en vez de duplicarlo.
pub(crate) fn hash_file_bytes(path: &Path) -> Result<(String, u64, u64), String> {
    let mut file = fs::File::open(path).map_err(|e| format!("No se pudo abrir '{}': {e}", path.display()))?;
    let metadata = file.metadata().map_err(|e| format!("No se pudieron leer los metadatos: {e}"))?;
    let modified_unix = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| format!("Error al leer el archivo: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Ok((format!("{:x}", hasher.finalize()), metadata.len(), modified_unix))
}

/// Hashes a single file with SHA-256. Used for one-off integrity checks
/// ("¿este instalador es el archivo real?") and as a building block for
/// directory baselines.
#[tauri::command]
pub fn hash_file(path: String) -> Result<FileHashEntry, String> {
    let (sha256, size_bytes, modified_unix) = hash_file_bytes(Path::new(&path))?;
    Ok(FileHashEntry { path, sha256, size_bytes, modified_unix })
}

/// Recursively hashes every regular file under `path`. Symlinks are not
/// followed (avoids cycles); unreadable files (permissions, in-use locks)
/// are skipped rather than aborting the whole scan.
#[tauri::command]
pub fn hash_directory(path: String) -> Result<DirectoryHashResult, String> {
    let root = Path::new(&path);
    if !root.exists() {
        return Err(format!("La ruta '{path}' no existe."));
    }

    let mut entries = Vec::new();
    let mut truncated = false;

    for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        if entries.len() >= MAX_FILES_PER_SCAN {
            truncated = true;
            break;
        }
        if let Ok((sha256, size_bytes, modified_unix)) = hash_file_bytes(entry.path()) {
            entries.push(FileHashEntry {
                path: entry.path().display().to_string(),
                sha256,
                size_bytes,
                modified_unix,
            });
        }
    }

    Ok(DirectoryHashResult { entries, truncated })
}

#[derive(Serialize, Deserialize, Clone)]
struct Baseline {
    name: String,
    root_path: String,
    created_at_unix: u64,
    entries: Vec<FileHashEntry>,
}

#[derive(Serialize)]
pub struct BaselineSummary {
    pub name: String,
    pub root_path: String,
    pub created_at_unix: u64,
    pub file_count: usize,
}

#[derive(Serialize)]
pub struct DriftReport {
    pub baseline_name: String,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub modified: Vec<String>,
    pub unchanged_count: usize,
    pub scanned_at_unix: u64,
}

fn baselines_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "No se pudo determinar el directorio de configuracion del sistema.".to_string())?;
    let dir = base.join("kryptos").join("baselines");
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear el directorio de lineas base: {e}"))?;
    Ok(dir)
}

/// Baseline names become filenames on disk, so anything outside
/// alphanumeric/dash/underscore is replaced — prevents path traversal via
/// a crafted name (e.g. `../../something`) and keeps filenames portable.
fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if cleaned.is_empty() {
        "linea_base".to_string()
    } else {
        cleaned
    }
}

fn baseline_path(name: &str) -> Result<PathBuf, String> {
    Ok(baselines_dir()?.join(format!("{}.json", sanitize_name(name))))
}

/// Snapshots a directory's current hashes under a named baseline, so future
/// scans can be diffed against "how it was" — the core of file-integrity
/// monitoring. Overwrites an existing baseline with the same name.
#[tauri::command]
pub fn save_baseline(name: String, root_path: String, entries: Vec<FileHashEntry>) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("El nombre de la linea base no puede estar vacio.".into());
    }
    let baseline = Baseline { name: name.clone(), root_path, created_at_unix: unix_now(), entries };
    let json = serde_json::to_string_pretty(&baseline).map_err(|e| format!("No se pudo preparar la linea base: {e}"))?;
    fs::write(baseline_path(&name)?, json).map_err(|e| format!("No se pudo guardar la linea base: {e}"))?;
    Ok(())
}

/// Lists saved baselines without loading every full entry list into memory
/// at once — just enough to populate a picker in the UI.
#[tauri::command]
pub fn list_baselines() -> Result<Vec<BaselineSummary>, String> {
    let dir = baselines_dir()?;
    let mut out = Vec::new();

    let read_dir = fs::read_dir(&dir).map_err(|e| format!("No se pudo leer el directorio de lineas base: {e}"))?;
    for entry in read_dir.filter_map(|e| e.ok()) {
        if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(content) = fs::read_to_string(entry.path()) {
            if let Ok(baseline) = serde_json::from_str::<Baseline>(&content) {
                out.push(BaselineSummary {
                    name: baseline.name,
                    root_path: baseline.root_path,
                    created_at_unix: baseline.created_at_unix,
                    file_count: baseline.entries.len(),
                });
            }
        }
    }

    out.sort_by(|a, b| b.created_at_unix.cmp(&a.created_at_unix));
    Ok(out)
}

/// Deletes a saved baseline. The frontend is responsible for confirming
/// with the user before calling — same convention as `kill_process`.
#[tauri::command]
pub fn delete_baseline(name: String, db: tauri::State<'_, crate::db::Db>) -> Result<(), String> {
    let path = baseline_path(&name)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("No se pudo eliminar la linea base: {e}"))?;
    }
    crate::commands::audit::record_audit_event(&db, "delete_baseline", &name, "ok", None);
    Ok(())
}

/// Re-scans a baseline's root path right now and diffs the fresh hashes
/// against what was saved: files added, removed, or changed content since
/// the baseline was taken. This is the actual "detect drift" step.
#[tauri::command]
pub fn compare_baseline(name: String) -> Result<DriftReport, String> {
    let content = fs::read_to_string(baseline_path(&name)?)
        .map_err(|e| format!("No se encontro la linea base '{name}': {e}"))?;
    let baseline: Baseline = serde_json::from_str(&content).map_err(|e| format!("La linea base esta corrupta: {e}"))?;

    let current = hash_directory(baseline.root_path.clone())?;
    let current_map: HashMap<&str, &FileHashEntry> = current.entries.iter().map(|e| (e.path.as_str(), e)).collect();
    let baseline_map: HashMap<&str, &FileHashEntry> = baseline.entries.iter().map(|e| (e.path.as_str(), e)).collect();

    let mut added = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged_count = 0usize;

    for (path, entry) in &current_map {
        match baseline_map.get(path) {
            None => added.push((*path).to_string()),
            Some(base_entry) => {
                if base_entry.sha256 != entry.sha256 {
                    modified.push((*path).to_string());
                } else {
                    unchanged_count += 1;
                }
            }
        }
    }

    let removed: Vec<String> = baseline_map
        .keys()
        .filter(|p| !current_map.contains_key(*p))
        .map(|p| (*p).to_string())
        .collect();

    Ok(DriftReport { baseline_name: name, added, removed, modified, unchanged_count, scanned_at_unix: unix_now() })
}

// ---------------------------------------------------------------------
// Verificador SSL/TLS
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct TlsCertificateInfo {
    pub host: String,
    pub port: u16,
    pub subject: String,
    pub issuer: String,
    pub not_before: String,
    pub not_after: String,
    pub days_until_expiry: i64,
    pub is_expired: bool,
    pub is_self_signed: bool,
    pub serial_number: String,
    pub signature_algorithm_oid: String,
    pub subject_alt_names: Vec<String>,
}

/// Connects to `host:port`, completes a TLS handshake, and reports what the
/// presented certificate actually says — expiry, issuer, SANs. Deliberately
/// accepts invalid/expired/self-signed certs during the handshake itself
/// (same idea as `openssl s_client`): the point of this tool is to *tell
/// you* your cert is expired or self-signed, not to refuse to look at it.
#[tauri::command]
pub fn check_tls_certificate(host: String, port: Option<u16>) -> Result<TlsCertificateInfo, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("Debes indicar un host o dominio.".into());
    }
    let port = port.unwrap_or(443);

    let connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| format!("No se pudo preparar el cliente TLS: {e}"))?;

    let tcp = TcpStream::connect((host.as_str(), port)).map_err(|e| format!("No se pudo conectar a {host}:{port}: {e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(8))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(8))).ok();

    let tls_stream = connector
        .connect(&host, tcp)
        .map_err(|e| format!("Fallo el saludo TLS con {host}:{port}: {e}"))?;

    let cert = tls_stream
        .peer_certificate()
        .map_err(|e| format!("No se pudo obtener el certificado: {e}"))?
        .ok_or_else(|| format!("{host}:{port} no presento ningun certificado."))?;
    let der = cert.to_der().map_err(|e| format!("No se pudo leer el certificado: {e}"))?;

    let (_, x509) =
        x509_parser::parse_x509_certificate(&der).map_err(|e| format!("No se pudo interpretar el certificado: {e}"))?;

    let validity = x509.validity();
    let days_until_expiry = validity.time_to_expiration().map(|d| d.whole_days()).unwrap_or(-1);
    let is_expired = !validity.is_valid();
    let is_self_signed = x509.subject() == x509.issuer();

    let subject_alt_names: Vec<String> = x509
        .subject_alternative_name()
        .ok()
        .flatten()
        .map(|ext| ext.value.general_names.iter().map(|gn| format!("{gn}")).collect())
        .unwrap_or_default();

    Ok(TlsCertificateInfo {
        host,
        port,
        subject: x509.subject().to_string(),
        issuer: x509.issuer().to_string(),
        not_before: validity.not_before.to_string(),
        not_after: validity.not_after.to_string(),
        days_until_expiry,
        is_expired,
        is_self_signed,
        serial_number: x509.raw_serial_as_string(),
        signature_algorithm_oid: x509.signature_algorithm.algorithm.to_string(),
        subject_alt_names,
    })
}

// ---------------------------------------------------------------------
// Consulta de CVE (NVD REST API 2.0) — puramente informativo: busca
// vulnerabilidades conocidas por palabra clave o ID, no las explota.
// ---------------------------------------------------------------------

const NVD_API_BASE: &str = "https://services.nvd.nist.gov/rest/json/cves/2.0";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvdResponse {
    total_results: u64,
    #[serde(default)]
    vulnerabilities: Vec<NvdVulnWrapper>,
}

#[derive(Deserialize)]
struct NvdVulnWrapper {
    cve: NvdCve,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvdCve {
    id: String,
    #[serde(default)]
    published: Option<String>,
    #[serde(default)]
    last_modified: Option<String>,
    #[serde(default)]
    vuln_status: Option<String>,
    #[serde(default)]
    descriptions: Vec<NvdLangString>,
    #[serde(default)]
    metrics: NvdMetrics,
    #[serde(default)]
    references: Vec<NvdReference>,
}

#[derive(Deserialize)]
struct NvdLangString {
    lang: String,
    value: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct NvdMetrics {
    #[serde(default)]
    cvss_metric_v31: Vec<NvdCvssMetric>,
    #[serde(default)]
    cvss_metric_v30: Vec<NvdCvssMetric>,
    #[serde(default)]
    cvss_metric_v2: Vec<NvdCvssMetric>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvdCvssMetric {
    cvss_data: NvdCvssData,
    // Only present on the v2 metric shape — v3.x carries severity inside
    // cvss_data instead. We check both when reading this.
    #[serde(default)]
    base_severity: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NvdCvssData {
    base_score: f32,
    #[serde(default)]
    base_severity: Option<String>,
    #[serde(default)]
    vector_string: Option<String>,
}

#[derive(Deserialize)]
struct NvdReference {
    url: String,
}

#[derive(Serialize)]
pub struct CveResult {
    pub id: String,
    pub published: Option<String>,
    pub last_modified: Option<String>,
    pub vuln_status: Option<String>,
    pub description: String,
    pub cvss_score: Option<f32>,
    pub cvss_severity: Option<String>,
    pub cvss_vector: Option<String>,
    pub references: Vec<String>,
}

#[derive(Serialize)]
pub struct CveSearchResult {
    pub total_results: u64,
    pub results: Vec<CveResult>,
}

fn nvd_cve_to_result(cve: NvdCve) -> CveResult {
    let description = cve
        .descriptions
        .iter()
        .find(|d| d.lang == "en")
        .or_else(|| cve.descriptions.first())
        .map(|d| d.value.clone())
        .unwrap_or_else(|| "Sin descripcion disponible.".to_string());

    let best_metric = cve
        .metrics
        .cvss_metric_v31
        .first()
        .or_else(|| cve.metrics.cvss_metric_v30.first())
        .or_else(|| cve.metrics.cvss_metric_v2.first());

    let (cvss_score, cvss_severity, cvss_vector) = match best_metric {
        Some(m) => (
            Some(m.cvss_data.base_score),
            m.cvss_data.base_severity.clone().or_else(|| m.base_severity.clone()),
            m.cvss_data.vector_string.clone(),
        ),
        None => (None, None, None),
    };

    CveResult {
        id: cve.id,
        published: cve.published,
        last_modified: cve.last_modified,
        vuln_status: cve.vuln_status,
        description,
        cvss_score,
        cvss_severity,
        cvss_vector,
        references: cve.references.into_iter().take(6).map(|r| r.url).collect(),
    }
}

/// Searches the public NVD database — either by exact `CVE-YYYY-NNNNN` id
/// or by free-text keyword (e.g. a product name). Purely informational: it
/// tells you what's known and how severe it is, never how to exploit it.
/// NVD rate-limits unauthenticated requests to a handful per 30s, so this
/// is meant for occasional lookups, not bulk scanning.
#[tauri::command]
pub fn search_cve(query: String) -> Result<CveSearchResult, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Escribe un ID de CVE o una palabra clave para buscar.".into());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("KRYPTOS-security-module/0.1 (+https://github.com/)")
        .build()
        .map_err(|e| format!("No se pudo preparar el cliente HTTP: {e}"))?;

    let is_cve_id = query.to_uppercase().starts_with("CVE-");
    let mut request = client.get(NVD_API_BASE);
    request = if is_cve_id {
        request.query(&[("cveId", query.to_uppercase())])
    } else {
        request.query(&[("keywordSearch", query), ("resultsPerPage", "15")])
    };

    let response = request.send().map_err(|e| format!("No se pudo contactar a la NVD: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "La NVD respondio con error {status}. Si buscas muy seguido, puede ser un limite de tasa — espera unos segundos."
        ));
    }

    let parsed: NvdResponse = response.json().map_err(|e| format!("No se pudo interpretar la respuesta de la NVD: {e}"))?;

    Ok(CveSearchResult {
        total_results: parsed.total_results,
        results: parsed.vulnerabilities.into_iter().map(|v| nvd_cve_to_result(v.cve)).collect(),
    })
}
