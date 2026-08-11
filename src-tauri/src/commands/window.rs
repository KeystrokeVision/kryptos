use tauri::{AppHandle, Manager};

/// Called by the frontend once it has actually rendered — closes the
/// splash window and shows the real one. Doing this from the frontend
/// (rather than a fixed Rust-side timer) means the splash never outlives
/// or undercuts the actual app startup time.
#[tauri::command]
pub fn close_splashscreen(app: AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}
