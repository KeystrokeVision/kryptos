use tauri::{AppHandle, Manager, Wry};

/// Sizes and positions the main window to exactly match its monitor's
/// work area (the screen minus the taskbar) on launch, so it always opens
/// filling the screen no matter the monitor size — deliberately *not*
/// done via `"maximized": true` in tauri.conf.json: Windows' own maximize
/// recalculates its own geometry for a maximized window and overrides an
/// explicit size/position set afterward, and for an undecorated
/// (`decorations: false`) window like this one that recalculation leaves
/// a few invisible pixels of overhang — normally hidden behind the system
/// title bar's own border, but with no title bar there it clips a sliver
/// of content at the right/bottom edge instead. A window sized explicitly
/// while in its normal (non-maximized) state doesn't hit that quirk.
/// Called both from `setup()` (before the window is ever shown, so there's
/// no visible jump) and again from `close_splashscreen` (after the webview
/// has actually finished initializing) — a size/position set this early
/// can land slightly off if WebView2 hasn't fully attached yet, so running
/// it again once the window is about to become visible catches whatever
/// the first pass missed.
pub fn snap_main_window_to_work_area(app: &impl Manager<Wry>) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let work_area = monitor.work_area();

    // set_position/set_size operate on the *outer* window rect, which
    // includes that invisible border — so naively feeding them the work
    // area's own bounds leaves the border's width/height as extra overhang
    // past the screen edge (exactly what was happening before this fix).
    // Measuring the window's own outer-vs-inner delta and compensating
    // with it means the *inner* (client) area — where content actually
    // renders — ends up exactly matching the work area, whatever that
    // border's real size turns out to be on this machine.
    let (Ok(outer_pos), Ok(inner_pos), Ok(outer_size), Ok(inner_size)) =
        (window.outer_position(), window.inner_position(), window.outer_size(), window.inner_size())
    else {
        return;
    };

    let border_left = inner_pos.x - outer_pos.x;
    let border_top = inner_pos.y - outer_pos.y;
    let border_width = outer_size.width as i32 - inner_size.width as i32;
    let border_height = outer_size.height as i32 - inner_size.height as i32;

    let target_x = work_area.position.x - border_left;
    let target_y = work_area.position.y - border_top;
    let target_w = (work_area.size.width as i32 + border_width).max(1) as u32;
    let target_h = (work_area.size.height as i32 + border_height).max(1) as u32;

    let _ = window.set_position(tauri::PhysicalPosition::new(target_x, target_y));
    let _ = window.set_size(tauri::PhysicalSize::new(target_w, target_h));

    // Windows applies its invisible border a little differently once a
    // window actually sits flush against a screen edge than it did at the
    // window's original (centered, edge-free) position — the single
    // compensation above lands close but not exact. Re-measuring the
    // *actual* resulting inner geometry and nudging by whatever's still
    // off closes that last gap without needing to hardcode a fixed value
    // that could be wrong on a different Windows build or theme.
    if let (Ok(actual_inner_pos), Ok(actual_inner_size)) = (window.inner_position(), window.inner_size()) {
        let dx = work_area.position.x - actual_inner_pos.x;
        let dy = work_area.position.y - actual_inner_pos.y;
        let dw = work_area.size.width as i32 - actual_inner_size.width as i32;
        let dh = work_area.size.height as i32 - actual_inner_size.height as i32;
        if dx != 0 || dy != 0 || dw != 0 || dh != 0 {
            let _ = window.set_position(tauri::PhysicalPosition::new(target_x + dx, target_y + dy));
            let _ = window.set_size(tauri::PhysicalSize::new((target_w as i32 + dw).max(1) as u32, (target_h as i32 + dh).max(1) as u32));
        }
    }
}

/// Called by the frontend once it has actually rendered — closes the
/// splash window and shows the real one. Doing this from the frontend
/// (rather than a fixed Rust-side timer) means the splash never outlives
/// or undercuts the actual app startup time.
#[tauri::command]
pub fn close_splashscreen(app: AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    snap_main_window_to_work_area(&app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}
