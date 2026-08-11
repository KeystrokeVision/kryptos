// Escaneo pasivo de Wi-Fi, Bluetooth y USB — todo de solo lectura, todo
// sobre hardware de este mismo equipo. Ninguno de estos comandos se conecta,
// empareja, ni transmite nada: solo leen lo que el propio adaptador ya
// detecto o lo que Windows ya tiene enumerado.

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize)]
pub struct WifiNetwork {
    pub ssid: String,
    pub signal_percent: Option<u8>,
    pub channel: Option<u32>,
    pub authentication: Option<String>,
}

#[derive(Serialize)]
pub struct BluetoothDevice {
    pub name: String,
    pub status: String,
    pub instance_id: String,
}

#[derive(Serialize)]
pub struct UsbDevice {
    pub name: String,
    pub status: String,
    pub instance_id: String,
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str) -> Result<String, String> {
    let output = crate::commands::run_powershell_utf8(script).map_err(|e| format!("No se pudo ejecutar PowerShell: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() { "El comando fallo sin mas detalles.".into() } else { stderr.to_string() });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct PnpDeviceRaw {
    #[serde(rename = "FriendlyName")]
    friendly_name: Option<String>,
    #[serde(rename = "Status")]
    status: Option<String>,
    #[serde(rename = "InstanceId")]
    instance_id: Option<String>,
}

#[cfg(target_os = "windows")]
fn parse_pnp_json(raw: &str) -> Vec<PnpDeviceRaw> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if let Ok(list) = serde_json::from_str::<Vec<PnpDeviceRaw>>(trimmed) {
        return list;
    }
    if let Ok(single) = serde_json::from_str::<PnpDeviceRaw>(trimmed) {
        return vec![single];
    }
    vec![]
}

/// Dispositivos Bluetooth que Windows ya conoce (emparejados o presentes
/// ahora mismo) — no es un escaneo activo de descubrimiento, es lo que el
/// sistema operativo ya tiene enumerado via Plug and Play.
#[tauri::command]
pub fn list_bluetooth_devices() -> Result<Vec<BluetoothDevice>, String> {
    #[cfg(target_os = "windows")]
    {
        let stdout = run_powershell(
            "Get-PnpDevice -Class Bluetooth -PresentOnly | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json -Compress",
        )?;
        Ok(parse_pnp_json(&stdout)
            .into_iter()
            .map(|d| BluetoothDevice {
                name: d.friendly_name.unwrap_or_else(|| "(sin nombre)".into()),
                status: d.status.unwrap_or_else(|| "Desconocido".into()),
                instance_id: d.instance_id.unwrap_or_default(),
            })
            .collect())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("El listado de Bluetooth solo esta disponible en Windows por ahora.".into())
    }
}

/// Dispositivos USB actualmente presentes segun Windows — el mismo listado
/// que muestra el Administrador de dispositivos, pensado para detectar a
/// ojo un dispositivo que no reconoces (defensa basica contra BadUSB), no
/// para monitoreo en tiempo real en el backend.
#[tauri::command]
pub fn list_usb_devices() -> Result<Vec<UsbDevice>, String> {
    #[cfg(target_os = "windows")]
    {
        let stdout = run_powershell(
            "Get-PnpDevice -Class USB -PresentOnly | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json -Compress",
        )?;
        Ok(parse_pnp_json(&stdout)
            .into_iter()
            .map(|d| UsbDevice {
                name: d.friendly_name.unwrap_or_else(|| "(sin nombre)".into()),
                status: d.status.unwrap_or_else(|| "Desconocido".into()),
                instance_id: d.instance_id.unwrap_or_default(),
            })
            .collect())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("El listado de USB solo esta disponible en Windows por ahora.".into())
    }
}

/// Parsea la salida de texto de `netsh wlan show networks mode=bssid`. El
/// formato de netsh cambia sus etiquetas segun el idioma de Windows (p.ej.
/// "Signal" vs "Senal"), asi que en vez de matchear una etiqueta exacta se
/// buscan patrones que no dependen del idioma: "SSID" no se traduce, un
/// porcentaje siempre termina en '%', y un canal siempre es el ultimo
/// numero de su linea.
#[cfg(target_os = "windows")]
fn parse_wifi_networks(raw: &str) -> Vec<WifiNetwork> {
    let mut networks = Vec::new();
    let mut current: Option<WifiNetwork> = None;

    for line in raw.lines() {
        let line = line.trim();

        if let Some(rest) = line.strip_prefix("SSID") {
            // "SSID 1 : MiRed" -> despues del primer ':' esta el nombre real.
            if let Some(colon) = rest.find(':') {
                if let Some(prev) = current.take() {
                    networks.push(prev);
                }
                let ssid = rest[colon + 1..].trim().to_string();
                current = Some(WifiNetwork { ssid, signal_percent: None, channel: None, authentication: None });
                continue;
            }
        }

        let Some(net) = current.as_mut() else { continue };

        if let Some(colon) = line.find(':') {
            let (label, value) = line.split_at(colon);
            let value = value[1..].trim();
            let label_lower = label.to_lowercase();

            if value.ends_with('%') {
                net.signal_percent = value.trim_end_matches('%').trim().parse().ok();
            } else if label_lower.contains("autenticaci") || label_lower.contains("authentication") {
                net.authentication = Some(value.to_string());
            } else if label_lower.contains("canal") || label_lower.contains("channel") {
                net.channel = value.parse().ok();
            }
        }
    }
    if let Some(prev) = current.take() {
        networks.push(prev);
    }
    networks
}

/// Escanea las redes Wi-Fi visibles para el adaptador de este equipo — el
/// mismo listado que ya muestra el icono de Wi-Fi de Windows, sin conectarse
/// a ninguna.
#[tauri::command]
pub fn list_wifi_networks() -> Result<Vec<WifiNetwork>, String> {
    #[cfg(target_os = "windows")]
    {
        // netsh no tiene forma propia de pedir salida en UTF-8, asi que se
        // envuelve en un cmd.exe que primero cambia la pagina de codigos de
        // esa consola a 65001 (UTF-8) — sin esto, SSIDs y etiquetas como
        // "Autenticacion" en un Windows en espanol salen con tildes rotas.
        let output = Command::new("cmd")
            .args(["/c", "chcp 65001>nul && netsh wlan show networks mode=bssid"])
            .output()
            .map_err(|e| format!("No se pudo ejecutar netsh: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        if stdout.trim().is_empty() {
            return Err("No se detecto ningun adaptador Wi-Fi, o esta apagado.".into());
        }
        Ok(parse_wifi_networks(&stdout))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("El escaneo de Wi-Fi solo esta disponible en Windows por ahora.".into())
    }
}
