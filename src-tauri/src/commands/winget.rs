use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::commands::audit::record_audit_event;
use crate::db::Db;

#[derive(Serialize, Clone)]
pub struct WingetPackage {
    pub name: String,
    pub id: String,
    pub version: String,
}

/// Parses `winget search`'s fixed-width table. Splits on runs of 2+ spaces
/// rather than slicing at the header's column positions — a value long
/// enough to overflow its column (most often the Id) pushes later columns
/// to the right on that row, which breaks fixed-offset slicing but not
/// this approach, since padding between columns is always 2+ spaces while
/// genuine multi-word values (like "Visual Studio Code") only ever use
/// single spaces internally. Validated against both a normal row and a
/// deliberately long-Id row that broke a naive position-based parser
/// during development.
fn parse_winget_table(output: &str) -> Vec<WingetPackage> {
    let lines: Vec<&str> = output.lines().collect();
    let Some(header_idx) = lines.iter().position(|l| l.contains("Name") && l.contains("Id") && l.contains("Version")) else {
        return vec![];
    };

    let mut results = Vec::new();
    for line in lines.iter().skip(header_idx + 2) {
        if line.trim().is_empty() || line.trim().chars().all(|c| c == '-') {
            continue;
        }
        let fields: Vec<&str> = line.split("  ").map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        if fields.len() >= 3 {
            results.push(WingetPackage { name: fields[0].to_string(), id: fields[1].to_string(), version: fields[2].to_string() });
        }
    }
    results
}

/// Whether winget is available at all — shown in the UI before offering
/// the store experience, since winget isn't guaranteed to be present on
/// every Windows install.
#[tauri::command]
pub fn is_winget_available() -> bool {
    Command::new("winget").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
}

/// Searches Microsoft's official winget repository — the same curated
/// source "Install Apps" in Windows Settings uses. Nothing here is hosted,
/// vetted, or distributed by KRYPTOS itself; it's a thin wrapper around
/// the OS's own trusted package manager.
#[tauri::command]
pub fn search_winget_packages(query: String) -> Result<Vec<WingetPackage>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("Escribe algo para buscar.".into());
    }

    let output = Command::new("winget")
        .args(["search", query, "--accept-source-agreements"])
        .output()
        .map_err(|e| format!("No se pudo ejecutar winget: {e}. ¿Esta instalado? (viene con Windows 10/11 actualizados; si falta, se instala 'App Installer' desde la Microsoft Store)"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let packages = parse_winget_table(&stdout);

    if packages.is_empty() {
        if stdout.to_lowercase().contains("no package found") {
            return Ok(vec![]);
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.status.success() && !stderr.trim().is_empty() {
            return Err(stderr.to_string());
        }
    }
    Ok(packages)
}

/// Installs a package by its exact winget ID. Deliberately uses `-e`
/// (exact match, case-sensitive) rather than a name-based fuzzy install —
/// if `id` was ever mis-parsed or truncated upstream, winget simply finds
/// no exact match and this fails cleanly with a clear error, rather than
/// silently installing a different package than the one shown.
#[tauri::command]
pub fn install_winget_package(id: String, db: State<'_, Db>) -> Result<String, String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("Falta el ID del paquete.".into());
    }

    let output = Command::new("winget")
        .args(["install", "--id", &id, "-e", "--accept-package-agreements", "--accept-source-agreements"])
        .output()
        .map_err(|e| format!("No se pudo ejecutar winget: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let success = output.status.success();
    record_audit_event(&db, "winget_install", &id, if success { "ok" } else { "error" }, if success { None } else { Some(&stdout) });

    if success {
        Ok(stdout)
    } else {
        Err(format!("La instalacion de '{id}' fallo:\n\n{stdout}"))
    }
}
