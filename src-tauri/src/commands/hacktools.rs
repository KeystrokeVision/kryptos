use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::process::Command;
use std::time::Duration;

use serde::Serialize;

/// External security/pentesting tools KRYPTOS can detect and launch, but
/// never bundles, installs, or automates the actual use of — same boundary
/// Modo Hacker already draws for everything else ("solo pasivo, local, o
/// sobre tus propios activos"). Every entry here is one of:
///   - a thin "is it on PATH, and if so open/run it" wrapper, identical in
///     spirit to how Aplicaciones launches an installed program;
///   - for tools that take a single target (a host, URL, or local path),
///     a *fixed*, non-configurable argument template — same restriction
///     `run_advanced_scan` already applies to nmap, extended to the rest
///     of the recon/audit tools that have an equally safe non-interactive
///     single-target invocation;
///   - for self-hosted scanners/dashboards (OpenVAS, Nessus, SonarQube),
///     just checking whether something is already listening on their
///     default port and, if so, opening it — KRYPTOS never starts these
///     services itself;
///   - for actively offensive/interactive tools (Metasploit, Aircrack-ng,
///     Netcat, Bettercap, Gobuster, ffuf), only a bare launch into their
///     own console — no target, wordlist, or module is chosen for the
///     user. What happens after that console opens is entirely on them,
///     same as if they'd opened it themselves from a shortcut.
///
/// Detection never simulates — an entry is only ever reported `installed`
/// if the real binary actually responded (see `spawns`).
#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolAction {
    /// Its own dedicated tab elsewhere in Modo Hacker (nmap).
    Dedicated,
    /// Spawn with no arguments — an interactive console/GUI tool.
    LaunchBare,
    /// Spawn the path found via common install locations (GUI apps not
    /// normally on PATH).
    LaunchGui,
    /// Takes one target (host/URL/local path) appended to a fixed,
    /// hardcoded flag template — see `run_target_command`.
    RunTarget,
    /// Runs against this machine only, no target needed (Lynis).
    RunLocal,
    /// Self-hosted web UI KRYPTOS only opens, never starts.
    OpenUrl,
    /// No safe generic action here — status + documentation only.
    DocsOnly,
}

/// Where "Instalar" actually installs from, when it can — real installers
/// only, never a bundled/redistributed copy (several of these tools are
/// gigabytes, GPL-incompatible with bundling, or commercially licensed —
/// Nessus/Burp Pro can't legally be redistributed by KRYPTOS at all).
/// `None` means there's genuinely no unattended install path on Windows
/// for this tool; the UI shows the official download page instead of a
/// button that would pretend to install something.
#[derive(Clone, Copy)]
pub enum InstallSource {
    /// Installed via `winget install --id <id>` — the exact same call
    /// Aplicaciones' Tienda tab already uses (see `commands::winget`).
    Winget(&'static str),
    /// Installed via `pip install --user <package>` — for the handful of
    /// tools whose own docs recommend pip as the primary install method.
    Pip(&'static str),
    None,
}

pub struct ToolDef {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub docs_url: &'static str,
    pub action: ToolAction,
    pub install: InstallSource,
}

#[derive(Serialize, Clone)]
pub struct ExternalToolStatus {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub docs_url: String,
    pub action: ToolAction,
    pub installed: bool,
    /// Best-effort context — usually the first line of the tool's own
    /// `--version` output, so whatever's shown is real tool output, never
    /// a made-up version number.
    pub detail: Option<String>,
    /// The literal command this entry would run — shown in the UI so
    /// nothing about "what actually happens" is hidden or assumed.
    pub command_preview: String,
    /// winget package id, when `install` is `InstallSource::Winget` — lets
    /// the frontend call the existing `install_winget_package` command
    /// directly, no separate install command needed for this path.
    pub winget_id: Option<String>,
    /// True when `install` is `InstallSource::Pip` — the frontend calls
    /// `install_hacktool_pip(id)`, which looks the package name up
    /// server-side so it never has to know it itself.
    pub pip_installable: bool,
}

const RECON: &str = "RECON / OSINT";
const WEB: &str = "SEGURIDAD WEB";
const NETWORK: &str = "SEGURIDAD DE RED";
const AUDIT: &str = "AUDITORIA DE SISTEMAS";
const VULN: &str = "EVALUACION DE VULNERABILIDADES";
const CODE: &str = "SEGURIDAD DE CODIGO";
const PENTEST: &str = "PENTESTING";

const TOOLS: &[ToolDef] = &[
    ToolDef { id: "nmap", name: "Nmap", category: RECON, description: "Descubrimiento de hosts, puertos y servicios. Tiene su propia pestana arriba, con presets fijos.", docs_url: "https://nmap.org/download.html", action: ToolAction::Dedicated, install: InstallSource::Winget("Insecure.Nmap") },
    ToolDef { id: "amass", name: "Amass", category: RECON, description: "Enumeracion de subdominios en modo pasivo (sin tocar el objetivo directamente).", docs_url: "https://github.com/owasp-amass/amass", action: ToolAction::RunTarget, install: InstallSource::Winget("OWASP.Amass") },
    ToolDef { id: "subfinder", name: "Subfinder", category: RECON, description: "Enumeracion pasiva de subdominios a partir de fuentes publicas.", docs_url: "https://github.com/projectdiscovery/subfinder", action: ToolAction::RunTarget, install: InstallSource::None },
    ToolDef { id: "theharvester", name: "theHarvester", category: RECON, description: "OSINT pasivo: correos, subdominios y nombres desde fuentes publicas (crt.sh).", docs_url: "https://github.com/laramies/theHarvester", action: ToolAction::RunTarget, install: InstallSource::None },
    ToolDef { id: "spiderfoot", name: "SpiderFoot", category: RECON, description: "Plataforma de OSINT automatizado — abre su propio panel web local.", docs_url: "https://www.spiderfoot.net/download/", action: ToolAction::LaunchBare, install: InstallSource::None },
    ToolDef { id: "whois", name: "Whois", category: RECON, description: "Datos de registro de un dominio o IP.", docs_url: "https://www.nirsoft.net/utils/whois_this_domain.html", action: ToolAction::RunTarget, install: InstallSource::Winget("Microsoft.Sysinternals.Whois") },
    ToolDef { id: "dnsrecon", name: "DNSRecon", category: RECON, description: "Enumeracion y reconocimiento de registros DNS de un dominio.", docs_url: "https://github.com/darkoperator/dnsrecon", action: ToolAction::RunTarget, install: InstallSource::Pip("dnsrecon") },
    ToolDef { id: "burpsuite", name: "Burp Suite", category: WEB, description: "Proxy de intercepcion para probar aplicaciones web propias o autorizadas.", docs_url: "https://portswigger.net/burp/communitydownload", action: ToolAction::LaunchGui, install: InstallSource::Winget("PortSwigger.BurpSuite.Community") },
    ToolDef { id: "zap", name: "OWASP ZAP", category: WEB, description: "Proxy y escaner de vulnerabilidades web, alternativa libre a Burp.", docs_url: "https://www.zaproxy.org/download/", action: ToolAction::LaunchGui, install: InstallSource::Winget("ZAP.ZAP") },
    ToolDef { id: "nikto", name: "Nikto", category: WEB, description: "Escaner de servidores web: archivos peligrosos, software desactualizado, config insegura.", docs_url: "https://github.com/sullo/nikto", action: ToolAction::RunTarget, install: InstallSource::None },
    ToolDef { id: "gobuster", name: "Gobuster", category: WEB, description: "Fuerza bruta de directorios, DNS y vhosts. Se abre en su propia consola — el diccionario y el objetivo los eliges vos ahi.", docs_url: "https://github.com/OJ/gobuster", action: ToolAction::LaunchBare, install: InstallSource::None },
    ToolDef { id: "ffuf", name: "FFUF", category: WEB, description: "Fuzzer web rapido. Se abre en su propia consola por la misma razon que Gobuster.", docs_url: "https://github.com/ffuf/ffuf", action: ToolAction::LaunchBare, install: InstallSource::Winget("ffuf.ffuf") },
    ToolDef { id: "wapiti", name: "Wapiti", category: WEB, description: "Escaner de vulnerabilidades web de caja negra (SQLi, XSS, etc.) sobre una URL.", docs_url: "https://wapiti-scanner.github.io/", action: ToolAction::RunTarget, install: InstallSource::Pip("wapiti3") },
    ToolDef { id: "testssl", name: "testssl.sh", category: WEB, description: "Audita la configuracion TLS/SSL de un host:puerto.", docs_url: "https://testssl.sh/", action: ToolAction::RunTarget, install: InstallSource::None },
    ToolDef { id: "wireshark", name: "Wireshark", category: NETWORK, description: "Analizador de trafico de red con interfaz grafica.", docs_url: "https://www.wireshark.org/download.html", action: ToolAction::LaunchGui, install: InstallSource::Winget("WiresharkFoundation.Wireshark") },
    ToolDef { id: "tcpdump", name: "tcpdump", category: NETWORK, description: "Captura de paquetes por linea de comandos. Se abre en su propia consola.", docs_url: "https://www.tcpdump.org/", action: ToolAction::LaunchBare, install: InstallSource::None },
    ToolDef { id: "aircrack", name: "Aircrack-ng", category: NETWORK, description: "Suite de auditoria Wi-Fi. Se abre en su propia consola — requiere un adaptador en modo monitor.", docs_url: "https://www.aircrack-ng.org/downloads.html", action: ToolAction::LaunchBare, install: InstallSource::None },
    ToolDef { id: "netcat", name: "Netcat", category: NETWORK, description: "Herramienta de red de proposito general (ncat). Se abre en su propia consola — viene incluida si instalas Nmap.", docs_url: "https://nmap.org/ncat/", action: ToolAction::LaunchBare, install: InstallSource::None },
    ToolDef { id: "bettercap", name: "Bettercap", category: NETWORK, description: "Framework de reconocimiento y ataque de red (MITM incluido). Se abre en su propia consola — usalo solo en redes tuyas o autorizadas.", docs_url: "https://www.bettercap.org/installation/", action: ToolAction::LaunchBare, install: InstallSource::None },
    ToolDef { id: "lynis", name: "Lynis", category: AUDIT, description: "Auditoria de seguridad y hardening de ESTE equipo — no toma un objetivo externo.", docs_url: "https://cisofy.com/lynis/", action: ToolAction::RunLocal, install: InstallSource::None },
    ToolDef { id: "openscap", name: "OpenSCAP", category: AUDIT, description: "Escaneo de cumplimiento contra perfiles SCAP. Necesita elegir un perfil/contenido SCAP propio, asi que aca solo mostramos estado y documentacion.", docs_url: "https://www.open-scap.org/getting-started/", action: ToolAction::DocsOnly, install: InstallSource::None },
    ToolDef { id: "openvas", name: "Greenbone / OpenVAS", category: VULN, description: "Escaner de vulnerabilidades autohospedado. KRYPTOS solo abre su panel si ya esta corriendo en este equipo.", docs_url: "https://greenbone.github.io/docs/latest/22.4/container/", action: ToolAction::OpenUrl, install: InstallSource::None },
    ToolDef { id: "nessus", name: "Nessus", category: VULN, description: "Escaner de vulnerabilidades comercial. KRYPTOS solo abre su panel si ya esta corriendo en este equipo.", docs_url: "https://www.tenable.com/downloads/nessus", action: ToolAction::OpenUrl, install: InstallSource::Winget("Tenable.Nessus") },
    ToolDef { id: "trivy", name: "Trivy", category: VULN, description: "Escaneo de vulnerabilidades en una imagen de contenedor.", docs_url: "https://aquasecurity.github.io/trivy/", action: ToolAction::RunTarget, install: InstallSource::Winget("AquaSecurity.Trivy") },
    ToolDef { id: "semgrep", name: "Semgrep", category: CODE, description: "Analisis estatico de codigo con reglas por defecto sobre una carpeta local.", docs_url: "https://semgrep.dev/docs/getting-started/", action: ToolAction::RunTarget, install: InstallSource::Pip("semgrep") },
    ToolDef { id: "sonarqube", name: "SonarQube", category: CODE, description: "Plataforma de calidad/seguridad de codigo autohospedada. KRYPTOS solo abre su panel si ya esta corriendo.", docs_url: "https://www.sonarsource.com/products/sonarqube/downloads/", action: ToolAction::OpenUrl, install: InstallSource::None },
    ToolDef { id: "gitleaks", name: "Gitleaks", category: CODE, description: "Busca secretos y credenciales filtradas en un repositorio local.", docs_url: "https://github.com/gitleaks/gitleaks", action: ToolAction::RunTarget, install: InstallSource::Winget("Gitleaks.Gitleaks") },
    ToolDef { id: "bandit", name: "Bandit", category: CODE, description: "Analisis estatico de seguridad para codigo Python, sobre una carpeta local.", docs_url: "https://bandit.readthedocs.io/", action: ToolAction::RunTarget, install: InstallSource::Pip("bandit") },
    ToolDef { id: "dependency_check", name: "OWASP Dependency-Check", category: CODE, description: "Busca dependencias con CVEs conocidos en un proyecto local. La primera corrida descarga la base de datos NVD y puede tardar varios minutos.", docs_url: "https://owasp.org/www-project-dependency-check/", action: ToolAction::RunTarget, install: InstallSource::None },
    ToolDef { id: "metasploit", name: "Metasploit Framework", category: PENTEST, description: "Framework de explotacion. Se abre en su propia consola (msfconsole) — todo lo que hagas ahi es responsabilidad tuya y debe estar autorizado.", docs_url: "https://www.metasploit.com/download", action: ToolAction::LaunchBare, install: InstallSource::None },
    ToolDef { id: "kali", name: "Kali Linux (WSL)", category: PENTEST, description: "Abre una shell de tu distribucion Kali en WSL — instalala primero con el boton de abajo (paquete oficial de OffSec).", docs_url: "https://www.kali.org/get-kali/#kali-platforms", action: ToolAction::LaunchBare, install: InstallSource::Winget("OffSec.KaliLinux") },
];

/// True if `program` can be spawned at all (exit code doesn't matter —
/// some CLI tools exit non-zero on `--version`/`--help`; what we're
/// checking is "does this binary exist and run", not "did this particular
/// invocation succeed").
fn spawns(program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    Command::new(program).args(args).output()
}

/// First non-empty line of a command's combined stdout+stderr, trimmed and
/// capped — used purely as a human-readable "yes, and here's what it told
/// us" detail, never as a parsed/guaranteed version number.
fn first_line_of(output: &std::process::Output) -> Option<String> {
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&output.stderr).to_string();
    }
    let line = text.lines().find(|l| !l.trim().is_empty())?.trim();
    Some(if line.len() > 140 { format!("{}…", &line[..140]) } else { line.to_string() })
}

/// (program, version-args) used for the plain "is it on PATH" tools —
/// everything except the handful with bespoke detection below (Kali,
/// Burp, ZAP, Wireshark, and the port-checked self-hosted services).
fn detect_cmd(id: &str) -> Option<(&'static str, &'static [&'static str])> {
    Some(match id {
        "nmap" => ("nmap", &["-V"]),
        "amass" => ("amass", &["-version"]),
        "subfinder" => ("subfinder", &["-version"]),
        "theharvester" => ("theHarvester", &["-h"]),
        "spiderfoot" => ("spiderfoot", &["--version"]),
        "whois" => ("whois", &[]),
        "dnsrecon" => ("dnsrecon", &["--version"]),
        "nikto" => ("nikto", &["-Version"]),
        "gobuster" => ("gobuster", &["version"]),
        "ffuf" => ("ffuf", &["-V"]),
        "wapiti" => ("wapiti", &["--version"]),
        "testssl" => ("testssl.sh", &["--version"]),
        "tcpdump" => ("tcpdump", &["--version"]),
        "aircrack" => ("aircrack-ng", &["--help"]),
        "netcat" => ("ncat", &["--version"]),
        "bettercap" => ("bettercap", &["-version"]),
        "lynis" => ("lynis", &["--version"]),
        "openscap" => ("oscap", &["--version"]),
        "trivy" => ("trivy", &["--version"]),
        "semgrep" => ("semgrep", &["--version"]),
        "gitleaks" => ("gitleaks", &["version"]),
        "bandit" => ("bandit", &["--version"]),
        "dependency_check" => ("dependency-check", &["--version"]),
        "metasploit" => ("msfconsole", &["-v"]),
        _ => return None,
    })
}

fn port_open(port: u16) -> bool {
    let addr: Option<SocketAddr> = format!("127.0.0.1:{port}").to_socket_addrs().ok().and_then(|mut a| a.next());
    match addr {
        Some(addr) => TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok(),
        None => false,
    }
}

fn open_url_target(id: &str) -> Option<(&'static str, u16)> {
    Some(match id {
        "openvas" => ("https://127.0.0.1:9392", 9392),
        "nessus" => ("https://127.0.0.1:8834", 8834),
        "sonarqube" => ("http://127.0.0.1:9000", 9000),
        _ => return None,
    })
}

#[cfg(target_os = "windows")]
fn decode_console_output(bytes: &[u8]) -> String {
    let looks_utf16le = bytes.len() >= 2
        && ((bytes[0] == 0xFF && bytes[1] == 0xFE)
            || bytes.iter().skip(1).step_by(2).take(40).filter(|&&b| b == 0).count() > 15);
    if looks_utf16le {
        let start = if bytes.starts_with(&[0xFF, 0xFE]) { 2 } else { 0 };
        let units: Vec<u16> = bytes[start..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

#[cfg(target_os = "windows")]
fn find_kali_wsl_distro() -> Option<String> {
    let output = Command::new("wsl.exe").args(["-l", "-q"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    decode_console_output(&output.stdout)
        .lines()
        .map(|l| l.trim().trim_matches('\u{0}').to_string())
        .find(|l| !l.is_empty() && l.to_lowercase().contains("kali"))
}

#[cfg(not(target_os = "windows"))]
fn find_kali_wsl_distro() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn find_in_program_files(relative: &[&str]) -> Option<String> {
    for root_var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        let Ok(root) = std::env::var(root_var) else { continue };
        for rel in relative {
            let candidate = std::path::PathBuf::from(&root).join(rel);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn find_in_program_files(_relative: &[&str]) -> Option<String> {
    None
}

fn find_burp_suite() -> Option<String> {
    find_in_program_files(&[
        "Programs\\BurpSuiteCommunity\\BurpSuiteCommunity.exe",
        "Programs\\BurpSuitePro\\BurpSuitePro.exe",
        "BurpSuiteCommunity\\BurpSuiteCommunity.exe",
        "BurpSuitePro\\BurpSuitePro.exe",
    ])
    .or_else(|| if spawns("burpsuite", &["--help"]).is_ok() { Some("burpsuite".to_string()) } else { None })
}

fn find_zap() -> Option<String> {
    find_in_program_files(&["ZAP\\Zed Attack Proxy\\zap.exe", "OWASP\\Zed Attack Proxy\\zap.exe"])
        .or_else(|| if spawns("zap.sh", &["-version"]).is_ok() { Some("zap.sh".to_string()) } else { None })
}

fn find_wireshark() -> Option<String> {
    find_in_program_files(&["Wireshark\\Wireshark.exe"])
        .or_else(|| if spawns("wireshark", &["-v"]).is_ok() { Some("wireshark".to_string()) } else { None })
}

/// Reports whether each tool is available on this machine, so the UI can
/// show "listo para abrir" vs. a link to go install it — KRYPTOS never
/// downloads or installs any of these itself, and never reports something
/// as installed without having actually just run it.
#[tauri::command]
pub fn list_hacktool_status() -> Vec<ExternalToolStatus> {
    TOOLS
        .iter()
        .map(|t| {
            let (installed, detail) = match t.id {
                "kali" => {
                    let distro = find_kali_wsl_distro();
                    (distro.is_some(), distro)
                }
                "burpsuite" => {
                    let path = find_burp_suite();
                    (path.is_some(), path)
                }
                "zap" => {
                    let path = find_zap();
                    (path.is_some(), path)
                }
                "wireshark" => {
                    let path = find_wireshark();
                    (path.is_some(), path)
                }
                _ if t.action == ToolAction::OpenUrl => {
                    let (_, port) = open_url_target(t.id).unwrap();
                    let open = port_open(port);
                    (open, if open { Some(format!("Servicio activo en el puerto {port}")) } else { None })
                }
                _ => match detect_cmd(t.id).and_then(|(p, a)| spawns(p, a).ok()) {
                    Some(out) => (true, first_line_of(&out)),
                    None => (false, None),
                },
            };

            let (winget_id, pip_installable) = match t.install {
                InstallSource::Winget(id) => (Some(id.to_string()), false),
                InstallSource::Pip(_) => (None, true),
                InstallSource::None => (None, false),
            };

            ExternalToolStatus {
                id: t.id.to_string(),
                name: t.name.to_string(),
                category: t.category.to_string(),
                description: t.description.to_string(),
                docs_url: t.docs_url.to_string(),
                action: t.action,
                installed,
                detail,
                command_preview: command_preview_for(t.id),
                winget_id,
                pip_installable,
            }
        })
        .collect()
}

/// Installs a `InstallSource::Pip` tool with `pip install --user <package>`
/// (falls back to `pip3` if `pip` isn't on PATH) — the same "call the real
/// installer, show its real output" shape `install_winget_package` already
/// uses for the Winget-sourced tools.
#[tauri::command]
pub fn install_hacktool_pip(id: String, db: tauri::State<'_, crate::db::Db>) -> Result<String, String> {
    let def = TOOLS.iter().find(|t| t.id == id).ok_or_else(|| format!("Herramienta desconocida: '{id}'."))?;
    let InstallSource::Pip(package) = def.install else {
        return Err(format!("{} no se instala por pip.", def.name));
    };

    let mut last_err = None;
    for pip_bin in ["pip", "pip3"] {
        match Command::new(pip_bin).args(["install", "--user", package]).output() {
            Ok(out) => {
                let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
                let success = out.status.success();
                crate::commands::audit::record_audit_event(&db, "pip_install", package, if success { "ok" } else { "error" }, if success { None } else { Some(&text) });
                return if success { Ok(text) } else { Err(format!("La instalacion de '{package}' fallo:\n\n{text}")) };
            }
            Err(e) => last_err = Some(e),
        }
    }
    Err(format!(
        "No se encontro pip en el PATH ({}). Instala Python desde https://www.python.org/downloads/ e intentalo de nuevo.",
        last_err.map(|e| e.to_string()).unwrap_or_default()
    ))
}

fn command_preview_for(id: &str) -> String {
    match id {
        "nmap" => "nmap -T4 --top-ports 100 <objetivo>".into(),
        "amass" => "amass enum -passive -d <dominio>".into(),
        "subfinder" => "subfinder -silent -d <dominio>".into(),
        "theharvester" => "theHarvester -b crtsh -d <dominio>".into(),
        "spiderfoot" => "spiderfoot -l 127.0.0.1:5009".into(),
        "whois" => "whois <dominio o IP>".into(),
        "dnsrecon" => "dnsrecon -d <dominio>".into(),
        "burpsuite" => "(abre la aplicacion instalada)".into(),
        "zap" => "(abre la aplicacion instalada)".into(),
        "nikto" => "nikto -h <url>".into(),
        "gobuster" => "gobuster (consola interactiva)".into(),
        "ffuf" => "ffuf (consola interactiva)".into(),
        "wapiti" => "wapiti -u <url>".into(),
        "testssl" => "testssl.sh <host:puerto>".into(),
        "wireshark" => "(abre la aplicacion instalada)".into(),
        "tcpdump" => "tcpdump (consola interactiva)".into(),
        "aircrack" => "aircrack-ng (consola interactiva)".into(),
        "netcat" => "ncat (consola interactiva)".into(),
        "bettercap" => "bettercap (consola interactiva)".into(),
        "lynis" => "lynis audit system".into(),
        "openscap" => "oscap ... --profile <perfil-scap-propio>".into(),
        "openvas" => "abre https://127.0.0.1:9392".into(),
        "nessus" => "abre https://127.0.0.1:8834".into(),
        "trivy" => "trivy image <imagen>".into(),
        "semgrep" => "semgrep --config auto <carpeta>".into(),
        "sonarqube" => "abre http://127.0.0.1:9000".into(),
        "gitleaks" => "gitleaks detect --no-banner --source <carpeta>".into(),
        "bandit" => "bandit -r <carpeta>".into(),
        "dependency_check" => "dependency-check --scan <carpeta> --format JSON --out <reporte>".into(),
        "metasploit" => "msfconsole".into(),
        "kali" => "wsl -d <distro-kali-detectada>".into(),
        other => other.to_string(),
    }
}

/// Opens a tool with `action: LaunchBare | LaunchGui` exactly like
/// double-clicking its own shortcut would — a fresh console for the CLI
/// tools, or its normal window for GUI apps. `action: DocsOnly`/`Dedicated`
/// entries have no launch path and are rejected here on purpose.
#[tauri::command]
pub fn launch_hacktool(id: String) -> Result<(), String> {
    let def = TOOLS.iter().find(|t| t.id == id).ok_or_else(|| format!("Herramienta desconocida: '{id}'."))?;

    match def.action {
        ToolAction::LaunchGui => {
            let path = match id.as_str() {
                "burpsuite" => find_burp_suite(),
                "zap" => find_zap(),
                "wireshark" => find_wireshark(),
                _ => None,
            }
            .ok_or_else(|| format!("No se encontro {} instalado. Descargalo desde {}.", def.name, def.docs_url))?;
            Command::new(&path).spawn().map(|_| ()).map_err(|e| format!("No se pudo abrir {}: {e}", def.name))
        }
        ToolAction::LaunchBare => {
            if id == "kali" {
                let distro = find_kali_wsl_distro().ok_or_else(|| {
                    "No se encontro una distribucion Kali en WSL. Instalala con 'wsl --install -d kali-linux'.".to_string()
                })?;
                return Command::new("wsl.exe").args(["-d", &distro]).spawn().map(|_| ()).map_err(|e| format!("No se pudo abrir Kali (WSL): {e}"));
            }
            let (program, _) = detect_cmd(&id).ok_or_else(|| format!("'{id}' no tiene un lanzador definido."))?;
            Command::new(program).spawn().map(|_| ()).map_err(|_| {
                format!("No se encontro '{program}' en el PATH. Instala {} desde {} e intentalo de nuevo.", def.name, def.docs_url)
            })
        }
        ToolAction::OpenUrl => {
            let (url, port) = open_url_target(&id).ok_or_else(|| "Sin URL configurada.".to_string())?;
            if !port_open(port) {
                return Err(format!("{} no parece estar corriendo en este equipo (nada escucha en el puerto {port}).", def.name));
            }
            open::that(url).map_err(|e| format!("No se pudo abrir {}: {e}", def.name))
        }
        ToolAction::RunTarget | ToolAction::RunLocal | ToolAction::DocsOnly | ToolAction::Dedicated => {
            Err(format!("{} no se abre asi — usa el panel de ejecucion o la pestana dedicada.", def.name))
        }
    }
}

/// (args-before-target) fixed, safe flag templates — the same "known
/// presets only, no free-form flags" restriction `run_advanced_scan`
/// already applies to nmap, extended to every other single-target tool.
fn run_target_args(id: &str) -> Option<(&'static str, Vec<&'static str>)> {
    Some(match id {
        "amass" => ("amass", vec!["enum", "-passive", "-d"]),
        "subfinder" => ("subfinder", vec!["-silent", "-d"]),
        "theharvester" => ("theHarvester", vec!["-b", "crtsh", "-d"]),
        "whois" => ("whois", vec![]),
        "dnsrecon" => ("dnsrecon", vec!["-d"]),
        "nikto" => ("nikto", vec!["-h"]),
        "wapiti" => ("wapiti", vec!["-u"]),
        "testssl" => ("testssl.sh", vec![]),
        "trivy" => ("trivy", vec!["image"]),
        "semgrep" => ("semgrep", vec!["--config", "auto"]),
        "gitleaks" => ("gitleaks", vec!["detect", "--no-banner", "--source"]),
        "bandit" => ("bandit", vec!["-r"]),
        _ => return None,
    })
}

#[derive(Serialize)]
pub struct HacktoolRunResult {
    pub success: bool,
    pub output: String,
}

/// Runs a single-target tool (or Lynis's fixed local audit) with its
/// hardcoded flag template and returns combined stdout/stderr. Same
/// blocking, one-shot shape as every other quick-tool in KRYPTOS
/// (`run_ping`, `run_advanced_scan`) — a slow target can make this take a
/// while, same characteristic those already have.
#[tauri::command]
pub fn run_hacktool_scan(id: String, target: Option<String>) -> Result<HacktoolRunResult, String> {
    let def = TOOLS.iter().find(|t| t.id == id).ok_or_else(|| format!("Herramienta desconocida: '{id}'."))?;

    let (program, args): (&str, Vec<String>) = if id == "lynis" {
        ("lynis", vec!["audit".into(), "system".into()])
    } else if id == "dependency_check" {
        let target = target.filter(|t| !t.trim().is_empty()).ok_or_else(|| "Indica la carpeta del proyecto a analizar.".to_string())?;
        let report_dir = crate::commands::portable_data_root()?.join("hacktool_reports").join("dependency-check");
        std::fs::create_dir_all(&report_dir).map_err(|e| format!("No se pudo crear la carpeta de reportes: {e}"))?;
        (
            "dependency-check",
            vec![
                "--noupdate".into(),
                "--scan".into(),
                target,
                "--format".into(),
                "JSON".into(),
                "--out".into(),
                report_dir.to_string_lossy().to_string(),
            ],
        )
    } else {
        let (program, prefix) = run_target_args(&id).ok_or_else(|| format!("'{}' no se ejecuta desde aca.", def.name))?;
        let target = target.filter(|t| !t.trim().is_empty()).ok_or_else(|| "Indica un objetivo.".to_string())?;
        let mut args: Vec<String> = prefix.iter().map(|s| s.to_string()).collect();
        args.push(target);
        (program, args)
    };

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match Command::new(program).args(&arg_refs).output() {
        Ok(out) => {
            let mut text = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.trim().is_empty() {
                text.push('\n');
                text.push_str(&stderr);
            }
            Ok(HacktoolRunResult { success: out.status.success(), output: text })
        }
        Err(_) => Err(format!("No se encontro '{program}' en el PATH. Instala {} desde {} e intentalo de nuevo.", def.name, def.docs_url)),
    }
}
