use image::{GenericImageView, Rgba, RgbaImage};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager};

/// The app's own bundled icon — reused as the tray icon's base image (see
/// `render_tray_icon`) instead of `app.default_window_icon()`, so we can
/// draw the alert-state badge onto our own decoded copy of it.
const TRAY_ICON_BASE: &[u8] = include_bytes!("../icons/icon.png");

const TRAY_ID: &str = "main_tray";

/// Sets up the tray icon and wires "close the main window" to hide it
/// instead of quitting — the standard "minimize to tray" pattern this kind
/// of always-available background app expects. The only real exit path is
/// the tray menu's "Salir" item.
///
/// The menu also doubles as a quick launcher (Terminal / Aplicaciones /
/// Centro de Operaciones) so reaching those doesn't require restoring the
/// window first — clicking one shows the window *and* jumps straight to
/// that module, via the `tray://open-module` event the frontend listens
/// for (see `src/components/layout/TrayBridge.tsx`).
pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Mostrar KRYPTOS", true, None::<&str>)?;
    let terminal_item = MenuItem::with_id(app, "open_terminal", "Abrir Terminal", true, None::<&str>)?;
    let apps_item = MenuItem::with_id(app, "open_apps", "Abrir Aplicaciones", true, None::<&str>)?;
    let opscenter_item = MenuItem::with_id(app, "open_opscenter", "Centro de Operaciones", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Salir de KRYPTOS", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &PredefinedMenuItem::separator(app)?,
            &terminal_item,
            &apps_item,
            &opscenter_item,
            &PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID).menu(&menu).tooltip("KRYPTOS");
    match render_tray_icon(false) {
        Ok(icon) => builder = builder.icon(icon),
        // Falls back to the plain bundled icon if decoding our own PNG
        // somehow fails — better a working tray icon with no badge support
        // than none at all.
        Err(_) => {
            if let Some(icon) = app.default_window_icon().cloned() {
                builder = builder.icon(icon);
            }
        }
    }

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            "show" => show_and_focus(app),
            "open_terminal" => show_and_open_module(app, "terminal"),
            "open_apps" => show_and_open_module(app, "apps"),
            "open_opscenter" => show_and_open_module(app, "opscenter"),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window_clone.hide();
            }
        });
    }

    Ok(())
}

fn show_and_focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_and_open_module(app: &AppHandle, module_id: &str) {
    show_and_focus(app);
    let _ = app.emit("tray://open-module", module_id);
}

/// Decodes the bundled tray icon and, when `alert` is true, paints a small
/// red dot with a dark ring in the bottom-right corner — the same kind of
/// at-a-glance "something needs attention" badge Windows itself uses for
/// notification-area icons, driven by Sentinel's unacknowledged alert
/// count (see `set_tray_alert_state`).
fn render_tray_icon(alert: bool) -> Result<tauri::image::Image<'static>, Box<dyn std::error::Error>> {
    let base = image::load_from_memory(TRAY_ICON_BASE)?;
    let (w, h) = base.dimensions();
    let mut img: RgbaImage = base.to_rgba8();

    if alert {
        let radius = (w.min(h) as f32 * 0.24) as i32;
        let cx = w as i32 - radius - 1;
        let cy = h as i32 - radius - 1;
        let ring = Rgba([12u8, 12, 12, 255]);
        let dot = Rgba([255u8, 51, 51, 255]);

        for y in (cy - radius - 3).max(0)..(cy + radius + 3).min(h as i32) {
            for x in (cx - radius - 3).max(0)..(cx + radius + 3).min(w as i32) {
                let dx = x - cx;
                let dy = y - cy;
                let dist_sq = dx * dx + dy * dy;
                if dist_sq <= radius * radius {
                    img.put_pixel(x as u32, y as u32, dot);
                } else if dist_sq <= (radius + 2) * (radius + 2) {
                    img.put_pixel(x as u32, y as u32, ring);
                }
            }
        }
    }

    Ok(tauri::image::Image::new_owned(img.into_raw(), w, h))
}

/// Swaps the tray icon between its normal and alert-badged form. Called
/// from the frontend whenever Sentinel's unacknowledged high/critical
/// alert count changes (see `SentinelWatcher`), so the icon in the
/// notification area reflects system state even while KRYPTOS is
/// minimized and nobody's looking at the Centro de Operaciones.
#[tauri::command]
pub fn set_tray_alert_state(app: AppHandle, alert: bool) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let icon = render_tray_icon(alert).map_err(|e| format!("No se pudo generar el icono de bandeja: {e}"))?;
    tray.set_icon(Some(icon)).map_err(|e| format!("No se pudo actualizar el icono de bandeja: {e}"))?;
    tray.set_tooltip(Some(if alert { "KRYPTOS — alertas pendientes" } else { "KRYPTOS" }))
        .map_err(|e| format!("No se pudo actualizar el tooltip de bandeja: {e}"))
}
