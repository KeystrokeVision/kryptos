use std::io::{Read, Write};
use std::net::TcpStream;
#[cfg(not(target_os = "windows"))]
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------
// DNS lookup
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct DnsRecord {
    pub record_type: String,
    pub value: String,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct WinDnsRaw {
    #[serde(rename = "Type")]
    r#type: Option<serde_json::Value>,
    #[serde(rename = "IPAddress")]
    ip_address: Option<String>,
    #[serde(rename = "NameHost")]
    name_host: Option<String>,
    #[serde(rename = "Strings")]
    strings: Option<Vec<String>>,
}

#[cfg(target_os = "windows")]
fn parse_dns_json(raw: &str) -> Vec<WinDnsRaw> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if let Ok(list) = serde_json::from_str::<Vec<WinDnsRaw>>(trimmed) {
        return list;
    }
    if let Ok(single) = serde_json::from_str::<WinDnsRaw>(trimmed) {
        return vec![single];
    }
    vec![]
}

#[cfg(target_os = "windows")]
fn lookup_dns_impl(domain: &str) -> Result<Vec<DnsRecord>, String> {
    let script = format!(
        "'A','AAAA','MX','TXT','NS' | ForEach-Object {{ Resolve-DnsName -Name '{domain}' -Type $_ -ErrorAction SilentlyContinue }} | Select-Object Type, IPAddress, NameHost, Strings | ConvertTo-Json -Compress -Depth 3",
        domain = domain.replace('\'', "''")
    );
    let output = crate::commands::run_powershell_utf8(&script).map_err(|e| format!("No se pudo ejecutar PowerShell: {e}"))?;
    if !output.status.success() {
        return Err("No se pudo resolver el dominio.".into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let records = parse_dns_json(&stdout)
        .into_iter()
        .filter_map(|r| {
            let record_type = r
                .r#type
                .map(|v| v.as_str().map(|s| s.to_string()).unwrap_or_else(|| v.to_string()))
                .unwrap_or_default();
            let value = r.ip_address.or(r.name_host).or_else(|| r.strings.map(|s| s.join(" ")))?;
            Some(DnsRecord { record_type, value })
        })
        .collect();
    Ok(records)
}

#[cfg(not(target_os = "windows"))]
fn lookup_dns_impl(domain: &str) -> Result<Vec<DnsRecord>, String> {
    let mut records = Vec::new();
    let mut any_ran = false;
    for rtype in ["A", "AAAA", "MX", "TXT", "NS"] {
        let output = Command::new("dig").args(["+short", rtype, domain]).output();
        let Ok(output) = output else { continue };
        any_ran = true;
        if !output.status.success() {
            continue;
        }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if !line.trim().is_empty() {
                records.push(DnsRecord { record_type: rtype.to_string(), value: line.trim().to_string() });
            }
        }
    }
    if !any_ran {
        return Err("No se pudo ejecutar 'dig' (paquete dnsutils/bind-tools).".into());
    }
    Ok(records)
}

/// Resolves A, AAAA, MX, TXT, and NS records for a domain — standard
/// passive reconnaissance, the same information any public DNS server
/// hands out to anyone who asks.
#[tauri::command]
pub fn lookup_dns(domain: String) -> Result<Vec<DnsRecord>, String> {
    let domain = domain.trim().to_string();
    if domain.is_empty() {
        return Err("Escribe un dominio.".into());
    }
    lookup_dns_impl(&domain)
}

// ---------------------------------------------------------------------
// WHOIS
// ---------------------------------------------------------------------

fn whois_query(server: &str, query: &str) -> Result<String, String> {
    let mut stream =
        TcpStream::connect((server, 43)).map_err(|e| format!("No se pudo conectar al servidor WHOIS {server}: {e}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok();
    stream
        .write_all(format!("{query}\r\n").as_bytes())
        .map_err(|e| format!("No se pudo enviar la consulta WHOIS: {e}"))?;

    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|e| format!("No se pudo leer la respuesta WHOIS: {e}"))?;
    Ok(response)
}

/// WHOIS has no single authoritative server — the standard approach is to
/// ask IANA which registry is responsible for this domain's TLD, then
/// query that registry directly. Falls back to the IANA response itself
/// if no referral is found (still useful — it names the registry).
#[tauri::command]
pub fn lookup_whois(domain: String) -> Result<String, String> {
    let domain = domain.trim().to_lowercase();
    if domain.is_empty() {
        return Err("Escribe un dominio.".into());
    }

    let iana_response = whois_query("whois.iana.org", &domain)?;

    let referred_server = iana_response
        .lines()
        .find(|line| line.to_lowercase().starts_with("refer:"))
        .and_then(|line| line.split(':').nth(1))
        .map(|s| s.trim().to_string());

    match referred_server {
        Some(server) if !server.is_empty() => match whois_query(&server, &domain) {
            Ok(full) => Ok(full),
            // If the registry query fails for any reason, the IANA
            // response is still informative — better than nothing.
            Err(_) => Ok(iana_response),
        },
        _ => Ok(iana_response),
    }
}

// ---------------------------------------------------------------------
// HTTP security headers
// ---------------------------------------------------------------------

#[derive(Serialize)]
pub struct SecurityHeaderCheck {
    pub name: String,
    pub present: bool,
    pub value: Option<String>,
    pub recommendation: String,
}

#[derive(Serialize)]
pub struct SecurityHeadersReport {
    pub url: String,
    pub status_code: u16,
    pub checks: Vec<SecurityHeaderCheck>,
}

const CHECKED_HEADERS: &[(&str, &str)] = &[
    ("strict-transport-security", "Fuerza HTTPS en visitas futuras (protege contra downgrade a HTTP)."),
    ("content-security-policy", "Limita de donde puede cargar scripts/recursos la pagina (mitiga XSS)."),
    ("x-content-type-options", "Evita que el navegador adivine el tipo de contenido (deberia ser 'nosniff')."),
    ("x-frame-options", "Evita que el sitio se cargue dentro de un iframe ajeno (clickjacking)."),
    ("referrer-policy", "Controla cuanta informacion de la URL de origen se envia al navegar a otro sitio."),
    ("permissions-policy", "Restringe que APIs del navegador (camara, ubicacion, etc.) puede usar la pagina."),
];

/// Fetches a URL and reports which common security-related HTTP response
/// headers are present — the same check tools like securityheaders.com
/// perform. Purely observational: it never sends anything malicious, just
/// reads what the server already publishes to every visitor.
#[tauri::command]
pub fn check_security_headers(url: String) -> Result<SecurityHeadersReport, String> {
    let mut url = url.trim().to_string();
    if url.is_empty() {
        return Err("Escribe una URL.".into());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("https://{url}");
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("KRYPTOS-security-module/0.1")
        .build()
        .map_err(|e| format!("No se pudo preparar el cliente HTTP: {e}"))?;

    let response = client.get(&url).send().map_err(|e| format!("No se pudo conectar a {url}: {e}"))?;
    let status_code = response.status().as_u16();

    let checks = CHECKED_HEADERS
        .iter()
        .map(|(name, recommendation)| {
            let header_value = response.headers().get(*name).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
            SecurityHeaderCheck {
                name: name.to_string(),
                present: header_value.is_some(),
                value: header_value,
                recommendation: recommendation.to_string(),
            }
        })
        .collect();

    Ok(SecurityHeadersReport { url, status_code, checks })
}
