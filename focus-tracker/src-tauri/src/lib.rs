mod accessibility;
mod error_state;
mod outbox;
mod pairing;
mod sessionizer;
mod state;
mod status_sync;
mod tracker;
mod uploader;
mod window_list;

use std::{thread, time::Duration};

use chrono::Utc;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, AppHandle, LogicalSize, Manager, PhysicalPosition, Position, Rect, Size,
    State,
    WindowEvent,
};

use crate::{
    error_state::normalize_focus_runtime_error,
    pairing::pair_device as exchange_pairing_code,
    sessionizer::QueuedSession,
    state::{
        build_status, create_state, local_date_string, should_auto_upload, ServerDaySnapshot,
        SharedState, TrackerStatus,
    },
    status_sync::fetch_remote_day_status,
    tracker::{get_enriched_sample, get_idle_seconds, is_user_away},
    uploader::upload_sessions,
};

const DEMO_FIXTURE: &str = include_str!("../../../tools/focus-collector/fixtures/demo-sessions.json");
const TRAY_ID: &str = "focus-tracker-tray";
const SAMPLE_IDLE_THRESHOLD_SECS: i64 = 180;
const COLLECT_GAP_FLUSH_SECS: i64 = 60;
const STATUS_SYNC_INTERVAL_SECS: i64 = 30;
const PANEL_EDGE_MARGIN_PX: i32 = 12;
const PANEL_VERTICAL_GAP_PX: i32 = 10;
const PANEL_WIDTH_PX: f64 = 368.0;
const PANEL_COMPACT_HEIGHT_PX: f64 = 330.0;
const PANEL_EXPANDED_HEIGHT_PX: f64 = 520.0;

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn format_short_duration(seconds: i64) -> String {
    let total_minutes = (seconds.max(0) + 59) / 60;
    let hours = total_minutes / 60;
    let minutes = total_minutes % 60;

    if hours == 0 {
        format!("{total_minutes}m")
    } else if minutes == 0 {
        format!("{hours}h")
    } else {
        format!("{hours}h {minutes}m")
    }
}

fn format_tray_title(work_secs: i64, goal_secs: i64) -> String {
    let clamped_goal = goal_secs.max(1);
    let progress = ((work_secs.max(0) * 100) / clamped_goal).clamp(0, 100);
    format!("{} · {}%", format_short_duration(work_secs), progress)
}

fn update_tray_title(app: &AppHandle, status: &TrackerStatus) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_title(Some(format_tray_title(
            status.today_work_secs,
            status.today_goal_secs,
        )));
    }
}

fn refresh_tray_title(app: &AppHandle, state: &SharedState) {
    let status = state
        .inner
        .lock()
        .map(|runtime| build_status(&runtime))
        .ok();

    if let Some(status) = status {
        update_tray_title(app, &status);
    }
}

fn menu_bar_icon() -> Image<'static> {
    let width = 18usize;
    let height = 18usize;
    let mut rgba = vec![0u8; width * height * 4];

    let mut paint = |x: usize, y: usize| {
        let index = (y * width + x) * 4;
        rgba[index] = 255;
        rgba[index + 1] = 255;
        rgba[index + 2] = 255;
        rgba[index + 3] = 255;
    };

    for x in 2..=4 {
        for y in 7..=15 {
            paint(x, y);
        }
    }

    for x in 7..=9 {
        for y in 3..=15 {
            paint(x, y);
        }
    }

    for x in 12..=14 {
        for y in 9..=15 {
            paint(x, y);
        }
    }

    Image::new_owned(rgba, width as u32, height as u32)
}

fn physical_point(position: Position, scale_factor: f64) -> (f64, f64) {
    match position {
        Position::Physical(position) => (f64::from(position.x), f64::from(position.y)),
        Position::Logical(position) => {
            let position = position.to_physical::<f64>(scale_factor);
            (position.x, position.y)
        }
    }
}

fn physical_size(size: Size, scale_factor: f64) -> (f64, f64) {
    match size {
        Size::Physical(size) => (size.width as f64, size.height as f64),
        Size::Logical(size) => {
            let size = size.to_physical::<f64>(scale_factor);
            (size.width, size.height)
        }
    }
}

fn position_main_window(
    app: &AppHandle,
    click_position: PhysicalPosition<f64>,
    tray_rect: Rect,
) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = monitors
        .into_iter()
        .find(|monitor| {
            let work_area = monitor.work_area();
            let left = work_area.position.x as f64;
            let right = left + work_area.size.width as f64;
            let top = work_area.position.y as f64;
            let bottom = top + work_area.size.height as f64;

            click_position.x >= left
                && click_position.x <= right
                && click_position.y >= top - 40.0
                && click_position.y <= bottom + 40.0
        })
        .or_else(|| window.current_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor();
    let (tray_x, tray_y) = physical_point(tray_rect.position, scale_factor);
    let (tray_width, tray_height) = physical_size(tray_rect.size, scale_factor);
    let (x, y) = compute_popover_origin(
        tray_x,
        tray_y,
        tray_width,
        tray_height,
        window_size.width,
        window_size.height,
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
    );

    let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
}

fn show_main_window(app: &AppHandle, tray_anchor: Option<(PhysicalPosition<f64>, Rect)>) {
    if let Some((click_position, rect)) = tray_anchor {
        position_main_window(app, click_position, rect);
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn compute_popover_origin(
    tray_x: f64,
    tray_y: f64,
    tray_width: f64,
    tray_height: f64,
    panel_width: u32,
    panel_height: u32,
    work_area_x: i32,
    work_area_y: i32,
    work_area_width: u32,
    work_area_height: u32,
) -> (i32, i32) {
    let panel_width = panel_width as i32;
    let panel_height = panel_height as i32;
    let mut x = (tray_x + tray_width / 2.0 - f64::from(panel_width) / 2.0).round() as i32;
    let mut y = (tray_y + tray_height + f64::from(PANEL_VERTICAL_GAP_PX)).round() as i32;

    let min_x = work_area_x + PANEL_EDGE_MARGIN_PX;
    let max_x = work_area_x + work_area_width as i32 - panel_width - PANEL_EDGE_MARGIN_PX;
    if min_x <= max_x {
        x = x.clamp(min_x, max_x);
    } else {
        x = min_x;
    }

    let min_y = work_area_y + PANEL_EDGE_MARGIN_PX;
    let max_y = work_area_y + work_area_height as i32 - panel_height - PANEL_EDGE_MARGIN_PX;
    if min_y <= max_y {
        y = y.clamp(min_y, max_y);
    } else {
        y = min_y;
    }

    (x, y)
}

fn start_visible_mode_enabled() -> bool {
    std::env::var("FOCUS_TRACKER_START_VISIBLE")
        .map(|value| value == "true")
        .unwrap_or(false)
}

fn toggle_main_window(app: &AppHandle, tray_anchor: Option<(PhysicalPosition<f64>, Rect)>) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            hide_main_window(app);
        } else {
            show_main_window(app, tray_anchor);
        }
    }
}

fn set_panel_expanded_inner(app: &AppHandle, expanded: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let height = if expanded {
            PANEL_EXPANDED_HEIGHT_PX
        } else {
            PANEL_COMPACT_HEIGHT_PX
        };
        let _ = window.set_size(Size::Logical(LogicalSize::new(PANEL_WIDTH_PX, height)));
    }
}

fn collect_once_inner(state: &SharedState) -> Result<(), String> {
    let observed_at = Utc::now();
    let idle_secs = get_idle_seconds();
    let away = is_user_away();
    let sample = if away || idle_secs >= SAMPLE_IDLE_THRESHOLD_SECS {
        None
    } else {
        get_enriched_sample()
    };

    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;

    if let Some(previous_collected_at) = runtime.last_collected_at {
        if should_flush_for_collect_gap(previous_collected_at, observed_at) {
            if let Some(closed) = runtime.sessionizer.flush(previous_collected_at) {
                runtime.outbox.record_session(closed);
                runtime.persist()?;
            }
        }
    }

    if let Some(closed) = runtime.sessionizer.observe(sample, observed_at, idle_secs) {
        runtime.outbox.record_session(closed);
        runtime.persist()?;
    }

    runtime.last_collected_at = Some(observed_at);

    Ok(())
}

fn should_flush_for_collect_gap(
    previous_collected_at: chrono::DateTime<Utc>,
    observed_at: chrono::DateTime<Utc>,
) -> bool {
    (observed_at - previous_collected_at).num_seconds() >= COLLECT_GAP_FLUSH_SECS
}

fn should_hide_on_focus_lost(_start_visible_mode: bool) -> bool {
    true
}

fn upload_queue_inner(
    state: &SharedState,
    base_url: String,
    api_key: String,
    time_zone: String,
) -> Result<(), String> {
    let (device_id, queued_sessions) = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;

        (
            runtime.outbox.device_id.clone(),
            runtime.outbox.queued_sessions.clone(),
        )
    };

    if queued_sessions.is_empty() {
        let mut runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;
        runtime.last_upload_message = Some("No queued sessions to upload".into());
        return Ok(());
    }

    let response = upload_sessions(&base_url, &api_key, &device_id, &time_zone, &queued_sessions)
        .map_err(|error| normalize_focus_runtime_error(&error))?;

    let rejected_summary = if response.rejected.is_empty() {
        "0 rejected".to_string()
    } else {
        response
            .rejected
            .iter()
            .map(|item| format!("{}: {}", item.source_session_id, item.reason))
            .collect::<Vec<_>>()
            .join(", ")
    };

    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;
    runtime
        .outbox
        .queued_sessions
        .retain(|session| !response.accepted.iter().any(|accepted| accepted == &session.source_session_id));
    runtime.last_upload_at = Some(Utc::now());
    runtime.last_upload_message = Some(format!(
        "Uploaded {} session(s) to {}, {}",
        response.accepted_count, response.time_zone, rejected_summary
    ));
    runtime.persist()?;

    Ok(())
}

fn auto_collect_and_upload(state: &SharedState) -> Result<(), String> {
    collect_once_inner(state)?;

    let (base_url, api_key, time_zone, device_id, ready_to_upload, should_sync_status, date) = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;
        let now = Utc::now();
        let time_zone_value = runtime.time_zone.clone();
        (
            runtime.base_url.clone(),
            runtime.api_key.clone(),
            time_zone_value.clone(),
            runtime.outbox.device_id.clone(),
            should_auto_upload(&runtime, now),
            runtime
                .server_day_snapshot
                .as_ref()
                .map(|snapshot| {
                    snapshot.date != local_date_string(
                        time_zone_value.parse().unwrap_or(chrono_tz::UTC),
                        now,
                    ) || (now - snapshot.fetched_at).num_seconds() >= STATUS_SYNC_INTERVAL_SECS
                })
                .unwrap_or(true),
            local_date_string(time_zone_value.parse().unwrap_or(chrono_tz::UTC), now),
        )
    };

    if base_url.trim().is_empty() || api_key.trim().is_empty() {
        return Ok(());
    }

    if ready_to_upload {
        upload_queue_inner(state, base_url.clone(), api_key.clone(), time_zone.clone())?;
    }

    if should_sync_status {
        let remote = fetch_remote_day_status(&base_url, &api_key, &device_id, &time_zone, &date)
            .map_err(|error| normalize_focus_runtime_error(&error))?;
        if let Ok(mut runtime) = state.inner.lock() {
            runtime.server_day_snapshot = Some(ServerDaySnapshot {
                date: remote.date,
                time_zone: remote.time_zone,
                focused_secs: remote.focused_secs,
                work_hours_secs: remote.work_hours_secs,
                sessions: remote.sessions,
                display_sessions: remote.display_sessions,
                fetched_at: chrono::DateTime::parse_from_rfc3339(&remote.fetched_at)
                    .map(|value| value.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            });
        }
    }

    Ok(())
}

#[tauri::command]
fn get_status(state: State<SharedState>) -> Result<TrackerStatus, String> {
    let runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;

    Ok(build_status(&runtime))
}

#[tauri::command]
fn collect_once(state: State<SharedState>) -> Result<TrackerStatus, String> {
    collect_once_inner(&state)?;

    let runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;
    Ok(build_status(&runtime))
}

#[tauri::command]
fn flush_current_session(state: State<SharedState>) -> Result<TrackerStatus, String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;

    if let Some(closed) = runtime.sessionizer.flush(Utc::now()) {
        runtime.outbox.record_session(closed);
        runtime.persist()?;
    }

    Ok(build_status(&runtime))
}

#[tauri::command]
fn load_demo_fixture(state: State<SharedState>) -> Result<TrackerStatus, String> {
    let sessions = serde_json::from_str::<Vec<QueuedSession>>(DEMO_FIXTURE)
        .map_err(|error| format!("failed to parse demo fixture: {error}"))?;

    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;
    for session in sessions {
        runtime.outbox.record_session(session);
    }
    runtime.persist()?;

    Ok(build_status(&runtime))
}

#[tauri::command]
fn upload_queue(state: State<'_, SharedState>) -> Result<TrackerStatus, String> {
    let (base_url, api_key, time_zone) = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;
        (
            runtime.base_url.clone(),
            runtime.api_key.clone(),
            runtime.time_zone.clone(),
        )
    };

    upload_queue_inner(&state, base_url, api_key, time_zone)?;

    let runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;
    Ok(build_status(&runtime))
}

#[tauri::command]
fn hide_panel(app: AppHandle) {
    hide_main_window(&app);
}

#[tauri::command]
fn set_panel_expanded(app: AppHandle, expanded: bool) {
    set_panel_expanded_inner(&app, expanded);
}

#[tauri::command]
fn update_settings(
    base_url: String,
    time_zone: String,
    state: State<'_, SharedState>,
) -> Result<TrackerStatus, String> {
    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;
    runtime.base_url = base_url.trim().to_string();
    runtime.time_zone = time_zone.trim().to_string();
    runtime.last_upload_message = Some("Collector settings updated".into());
    runtime.persist_all()?;
    Ok(build_status(&runtime))
}

#[tauri::command]
fn pair_device(
    base_url: String,
    pairing_code: String,
    device_name: String,
    time_zone: String,
    state: State<'_, SharedState>,
) -> Result<TrackerStatus, String> {
    let device_id = {
        let runtime = state
            .inner
            .lock()
            .map_err(|_| "failed to lock runtime state".to_string())?;
        runtime.outbox.device_id.clone()
    };

    let response = exchange_pairing_code(
        base_url.trim(),
        pairing_code.trim(),
        &device_id,
        device_name.trim(),
    )
    .map_err(|error| normalize_focus_runtime_error(&error))?;

    let mut runtime = state
        .inner
        .lock()
        .map_err(|_| "failed to lock runtime state".to_string())?;
    runtime.base_url = base_url.trim().to_string();
    runtime.api_key = response.token;
    runtime.time_zone = time_zone.trim().to_string();
    runtime.last_upload_message = Some(format!("Connected as {}", response.device_name));
    runtime.persist_all()?;
    Ok(build_status(&runtime))
}

fn spawn_background_loop(app: AppHandle) {
    thread::spawn(move || loop {
        let state = app.state::<SharedState>();
        if let Err(error) = auto_collect_and_upload(&state) {
            if let Ok(mut runtime) = state.inner.lock() {
                let normalized = normalize_focus_runtime_error(&error);
                if normalized.contains("Desktop token is no longer valid") {
                    runtime.api_key.clear();
                    runtime.server_day_snapshot = None;
                    let _ = runtime.persist_all();
                }
                runtime.last_upload_message = Some(normalized);
            }
        }
        refresh_tray_title(&app, &state);

        let interval_secs = state
            .inner
            .lock()
            .map(|runtime| runtime.sample_interval_secs)
            .unwrap_or(5);
        thread::sleep(Duration::from_secs(interval_secs.max(1)));
    });
}

fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let show_hide = MenuItem::with_id(app, "toggle_panel", "Toggle panel", true, None::<&str>)
        .map_err(|error| format!("failed to create toggle menu item: {error}"))?;
    let collect = MenuItem::with_id(app, "sample_once", "Sample once", true, None::<&str>)
        .map_err(|error| format!("failed to create sample menu item: {error}"))?;
    let upload = MenuItem::with_id(app, "upload_queue", "Upload queue", true, None::<&str>)
        .map_err(|error| format!("failed to create upload menu item: {error}"))?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|error| format!("failed to create quit menu item: {error}"))?;

    let menu = Menu::with_items(app, &[&show_hide, &collect, &upload, &quit])
        .map_err(|error| format!("failed to build tray menu: {error}"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(menu_bar_icon())
        .icon_as_template(true)
        .title("0m · 0%")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_panel" => toggle_main_window(app, None),
            "sample_once" => {
                let state = app.state::<SharedState>();
                let _ = collect_once_inner(&state);
            }
            "upload_queue" => {
                let state = app.state::<SharedState>();
                let (base_url, api_key, time_zone) = state
                    .inner
                    .lock()
                    .map(|runtime| {
                        (
                            runtime.base_url.clone(),
                            runtime.api_key.clone(),
                            runtime.time_zone.clone(),
                        )
                    })
                    .unwrap_or_default();
                let _ = upload_queue_inner(&state, base_url, api_key, time_zone);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                position,
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(&tray.app_handle(), Some((position, rect)));
            }
        })
        .build(app)
        .map_err(|error| format!("failed to build tray icon: {error}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(ActivationPolicy::Accessory);
                app.set_dock_visibility(false);
            }

            let state = create_state(&app.handle())?;
            app.manage(state);
            setup_tray(&app.handle())?;
            let state = app.state::<SharedState>();
            refresh_tray_title(&app.handle(), &state);
            spawn_background_loop(app.handle().clone());
            if start_visible_mode_enabled() {
                show_main_window(&app.handle(), None);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                hide_main_window(&window.app_handle());
            }

            if let WindowEvent::Focused(false) = event {
                if should_hide_on_focus_lost(start_visible_mode_enabled()) {
                    hide_main_window(&window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            collect_once,
            flush_current_session,
            load_demo_fixture,
            upload_queue,
            pair_device,
            update_settings,
            hide_panel
            ,
            set_panel_expanded
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};

    use super::{
        compute_popover_origin, format_tray_title, should_flush_for_collect_gap,
        should_hide_on_focus_lost,
    };

    #[test]
    fn centers_panel_below_tray_icon() {
        let (x, y) = compute_popover_origin(700.0, 0.0, 20.0, 24.0, 368, 440, 0, 24, 1440, 876);
        assert_eq!(x, 526);
        assert_eq!(y, 36);
    }

    #[test]
    fn clamps_panel_inside_monitor_work_area() {
        let (x, y) = compute_popover_origin(1400.0, 0.0, 24.0, 24.0, 368, 440, 0, 24, 1440, 876);
        assert_eq!(x, 1060);
        assert_eq!(y, 36);
    }

    #[test]
    fn flushes_after_long_collect_gap() {
        let previous = Utc.with_ymd_and_hms(2026, 3, 29, 10, 0, 0).unwrap();
        let observed = Utc.with_ymd_and_hms(2026, 3, 29, 10, 2, 0).unwrap();

        assert!(should_flush_for_collect_gap(previous, observed));
    }

    #[test]
    fn keeps_session_open_for_short_collect_gap() {
        let previous = Utc.with_ymd_and_hms(2026, 3, 29, 10, 0, 0).unwrap();
        let observed = Utc.with_ymd_and_hms(2026, 3, 29, 10, 0, 30).unwrap();

        assert!(!should_flush_for_collect_gap(previous, observed));
    }

    #[test]
    fn formats_tray_title_with_work_hours_and_goal_progress() {
        assert_eq!(format_tray_title(21_060, 28_800), "5h 51m · 73%");
        assert_eq!(format_tray_title(600, 28_800), "10m · 2%");
    }

    #[test]
    fn hides_window_when_focus_is_lost_even_in_start_visible_mode() {
        assert!(should_hide_on_focus_lost(true));
        assert!(should_hide_on_focus_lost(false));
    }
}
