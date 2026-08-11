#[cfg(not(target_os = "windows"))]
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct BaselineCheck {
    pub name: String,
    pub status: String, // "ok" | "warning" | "unknown"
    pub detail: String,
}

#[derive(Serialize)]
pub struct SecurityBaseline {
    pub checks: Vec<BaselineCheck>,
    pub score_percent: u8,
    pub generated_at_unix: i64,
    pub ran_elevated: bool,
}

#[cfg(target_os = "windows")]
#[derive(Deserialize, Default)]
struct WinBaselineRaw {
    #[serde(rename = "FirewallAllEnabled")]
    firewall_all_enabled: Option<bool>,
    #[serde(rename = "AntivirusEnabled")]
    antivirus_enabled: Option<bool>,
    #[serde(rename = "RealTimeProtectionEnabled")]
    realtime_protection_enabled: Option<bool>,
    #[serde(rename = "BitLockerStatus")]
    bitlocker_status: Option<String>,
    #[serde(rename = "UacEnabled")]
    uac_enabled: Option<bool>,
}

#[cfg(target_os = "windows")]
fn run_checks_impl() -> Vec<BaselineCheck> {
    let script = "$out = [ordered]@{}; \
        try { $fw = Get-NetFirewallProfile -ErrorAction Stop; $out.FirewallAllEnabled = -not ($fw | Where-Object { -not $_.Enabled }) } catch { $out.FirewallAllEnabled = $null }; \
        try { $mp = Get-MpComputerStatus -ErrorAction Stop; $out.AntivirusEnabled = [bool]$mp.AntivirusEnabled; $out.RealTimeProtectionEnabled = [bool]$mp.RealTimeProtectionEnabled } catch { $out.AntivirusEnabled = $null; $out.RealTimeProtectionEnabled = $null }; \
        try { $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop; $out.BitLockerStatus = $bl.ProtectionStatus.ToString() } catch { $out.BitLockerStatus = $null }; \
        try { $uac = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -ErrorAction Stop).EnableLUA; $out.UacEnabled = ($uac -eq 1) } catch { $out.UacEnabled = $null }; \
        $out | ConvertTo-Json -Compress";

    let output = crate::commands::run_powershell_utf8(script);

    let raw: WinBaselineRaw = match output {
        Ok(out) if out.status.success() => serde_json::from_str(String::from_utf8_lossy(&out.stdout).trim()).unwrap_or_default(),
        _ => WinBaselineRaw::default(),
    };

    let bool_check = |name: &str, value: Option<bool>, ok_detail: &str, warn_detail: &str, unknown_detail: &str| BaselineCheck {
        name: name.to_string(),
        status: match value {
            Some(true) => "ok",
            Some(false) => "warning",
            None => "unknown",
        }
        .to_string(),
        detail: match value {
            Some(true) => ok_detail.to_string(),
            Some(false) => warn_detail.to_string(),
            None => unknown_detail.to_string(),
        },
    };

    vec![
        bool_check(
            "Firewall de Windows",
            raw.firewall_all_enabled,
            "Los tres perfiles (Dominio/Privado/Publico) estan activos.",
            "Al menos un perfil del firewall esta desactivado.",
            "No se pudo verificar (¿ejecuta como Administrador?).",
        ),
        bool_check(
            "Antivirus (Windows Defender)",
            raw.antivirus_enabled,
            "Windows Defender esta activo.",
            "Windows Defender esta desactivado o no es el antivirus activo.",
            "No se pudo verificar — puede que uses otro antivirus.",
        ),
        bool_check(
            "Proteccion en tiempo real",
            raw.realtime_protection_enabled,
            "La proteccion en tiempo real esta activa.",
            "La proteccion en tiempo real esta desactivada.",
            "No se pudo verificar.",
        ),
        BaselineCheck {
            name: "Cifrado de disco (BitLocker)".to_string(),
            status: match raw.bitlocker_status.as_deref() {
                Some("On") => "ok",
                Some(_) => "warning",
                None => "unknown",
            }
            .to_string(),
            detail: match raw.bitlocker_status {
                Some(s) if s == "On" => "BitLocker esta activo en la unidad del sistema.".to_string(),
                Some(s) => format!("BitLocker no esta completamente activo (estado: {s})."),
                None => "No se pudo verificar (BitLocker puede no estar disponible en esta edicion de Windows).".to_string(),
            },
        },
        bool_check(
            "Control de cuentas de usuario (UAC)",
            raw.uac_enabled,
            "UAC esta activo — las acciones administrativas piden confirmacion.",
            "UAC esta desactivado. Esto reduce una capa importante de proteccion.",
            "No se pudo verificar.",
        ),
    ]
}

#[cfg(not(target_os = "windows"))]
fn run_checks_impl() -> Vec<BaselineCheck> {
    let mut checks = Vec::new();

    match Command::new("ufw").arg("status").output() {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            let active = text.contains("status: active");
            checks.push(BaselineCheck {
                name: "Firewall (ufw)".to_string(),
                status: if active { "ok" } else { "warning" }.to_string(),
                detail: if active { "ufw esta activo.".to_string() } else { "ufw esta instalado pero inactivo.".to_string() },
            });
        }
        _ => checks.push(BaselineCheck {
            name: "Firewall (ufw)".to_string(),
            status: "unknown".to_string(),
            detail: "ufw no esta instalado o no se pudo consultar; puede que uses iptables/nftables directamente.".to_string(),
        }),
    }

    match Command::new("lsblk").arg("-f").output() {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            let encrypted = text.contains("crypto_LUKS");
            checks.push(BaselineCheck {
                name: "Cifrado de disco (LUKS)".to_string(),
                status: if encrypted { "ok" } else { "warning" }.to_string(),
                detail: if encrypted {
                    "Se detecto al menos un volumen cifrado con LUKS.".to_string()
                } else {
                    "No se detecto ningun volumen LUKS montado.".to_string()
                },
            });
        }
        _ => checks.push(BaselineCheck {
            name: "Cifrado de disco".to_string(),
            status: "unknown".to_string(),
            detail: "No se pudo verificar (lsblk no disponible).".to_string(),
        }),
    }

    checks.push(BaselineCheck {
        name: "Antivirus".to_string(),
        status: "unknown".to_string(),
        detail: "Linux no tiene un estandar de antivirus como Windows Defender; este chequeo no aplica igual.".to_string(),
    });

    checks
}

/// Runs a quick security posture check — firewall, antivirus/real-time
/// protection, disk encryption, UAC — the same category of summary Windows
/// Security Center or a basic CIS benchmark gives you. Read-only.
#[tauri::command]
pub fn run_security_baseline() -> SecurityBaseline {
    let checks = run_checks_impl();
    let scored: Vec<&BaselineCheck> = checks.iter().filter(|c| c.status != "unknown").collect();
    let ok_count = scored.iter().filter(|c| c.status == "ok").count();
    let score_percent = if scored.is_empty() { 0 } else { ((ok_count as f64 / scored.len() as f64) * 100.0).round() as u8 };

    SecurityBaseline {
        checks,
        score_percent,
        generated_at_unix: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0),
        ran_elevated: crate::commands::elevation::is_elevated(),
    }
}
