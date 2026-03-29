use std::{fs, path::PathBuf, sync::Mutex};

use chrono::{DateTime, Duration, LocalResult, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    outbox::{counts_toward_work_hours, load_outbox, save_outbox, OutboxState},
    sessionizer::{FocusSessionizer, QueuedSession},
    status_sync::RemoteDisplaySession,
};

pub struct SharedState {
    pub inner: Mutex<RuntimeState>,
}

pub struct RuntimeState {
    pub sessionizer: FocusSessionizer,
    pub outbox_path: PathBuf,
    pub settings_path: PathBuf,
    pub outbox: OutboxState,
    pub server_day_snapshot: Option<ServerDaySnapshot>,
    pub base_url: String,
    pub api_key: String,
    pub time_zone: String,
    pub sample_interval_secs: u64,
    pub upload_interval_secs: u64,
    pub last_upload_at: Option<DateTime<Utc>>,
    pub last_upload_message: Option<String>,
    pub last_collected_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct ServerDaySnapshot {
    pub date: String,
    pub time_zone: String,
    pub focused_secs: i64,
    pub work_hours_secs: i64,
    pub sessions: Vec<QueuedSession>,
    pub display_sessions: Vec<RemoteDisplaySession>,
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerStatus {
    pub device_id: String,
    pub tracking_enabled: bool,
    pub queued_count: usize,
    pub base_url: String,
    pub api_key_present: bool,
    pub time_zone: String,
    pub sample_interval_secs: u64,
    pub today_focused_secs: i64,
    pub today_work_secs: i64,
    pub today_goal_secs: i64,
    pub timeline_segments: Vec<TimelineSegment>,
    pub current_session: Option<QueuedSession>,
    pub last_upload_at: Option<String>,
    pub last_upload_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSegment {
    pub source_session_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub started_at: String,
    pub ended_at: String,
    pub start_offset_secs: i64,
    pub duration_secs: i64,
    pub span_secs: i64,
    pub interruption_count: i64,
}

impl RuntimeState {
    pub fn persist(&self) -> Result<(), String> {
        save_outbox(&self.outbox_path, &self.outbox)
    }

    pub fn persist_all(&self) -> Result<(), String> {
        self.persist()?;
        save_settings(
            &self.settings_path,
            &PersistedSettings {
                base_url: self.base_url.clone(),
                api_key: self.api_key.clone(),
                time_zone: self.time_zone.clone(),
                sample_interval_secs: self.sample_interval_secs,
                upload_interval_secs: self.upload_interval_secs,
            },
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct PersistedSettings {
    base_url: String,
    api_key: String,
    time_zone: String,
    sample_interval_secs: u64,
    upload_interval_secs: u64,
}

pub fn create_state(app: &AppHandle) -> Result<SharedState, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
    let outbox_path = app_data_dir.join("focus-outbox.json");
    let settings_path = app_data_dir.join("focus-settings.json");
    let outbox = load_outbox(&outbox_path);
    let persisted_settings = load_settings(&settings_path);
    let default_settings = default_settings();
    let settings = persisted_settings.unwrap_or(default_settings);

    Ok(SharedState {
        inner: Mutex::new(RuntimeState {
            sessionizer: FocusSessionizer::new(300),
            outbox_path,
            settings_path,
            outbox,
            server_day_snapshot: None,
            base_url: settings.base_url,
            api_key: settings.api_key,
            time_zone: settings.time_zone,
            sample_interval_secs: settings.sample_interval_secs,
            upload_interval_secs: settings.upload_interval_secs,
            last_upload_at: None,
            last_upload_message: None,
            last_collected_at: None,
        }),
    })
}

pub fn build_status(state: &RuntimeState) -> TrackerStatus {
    build_status_at(state, Utc::now())
}

fn build_status_at(state: &RuntimeState, now: DateTime<Utc>) -> TrackerStatus {
    let current_session = state.sessionizer.current_session_at(now);
    let timeline_segments = timeline_for_today(state, current_session.clone(), now);
    let (today_focused_secs, today_work_secs) =
        metrics_for_today(state, current_session.clone(), now);

    TrackerStatus {
        device_id: state.outbox.device_id.clone(),
        tracking_enabled: true,
        queued_count: state.outbox.queued_sessions.len(),
        base_url: state.base_url.clone(),
        api_key_present: !state.api_key.trim().is_empty(),
        time_zone: state.time_zone.clone(),
        sample_interval_secs: state.sample_interval_secs,
        today_focused_secs,
        today_work_secs,
        today_goal_secs: 8 * 60 * 60,
        timeline_segments,
        current_session,
        last_upload_at: state.last_upload_at.map(|value| value.to_rfc3339()),
        last_upload_message: state.last_upload_message.clone(),
    }
}

fn timeline_for_today(
    state: &RuntimeState,
    current_session: Option<QueuedSession>,
    now: DateTime<Utc>,
) -> Vec<TimelineSegment> {
    let time_zone = parse_time_zone(&state.time_zone);
    let (day_start, day_end) = local_day_bounds(time_zone, now);
    let mut segments = if let Some(snapshot) = valid_server_snapshot(state, now) {
        let mut canonical = snapshot
            .display_sessions
            .iter()
            .filter_map(|session| {
                remote_display_session_to_timeline_segment(session, day_start, day_end)
            })
            .collect::<Vec<_>>();

        for session in local_overlay_sessions(state, current_session, snapshot, now) {
            if let Some(segment) = slice_session_for_day(&session, day_start, day_end) {
                canonical.push(segment);
            }
        }

        canonical
    } else {
        merged_sessions_for_display(state, current_session, now)
            .into_iter()
            .filter_map(|session| slice_session_for_day(&session, day_start, day_end))
            .collect::<Vec<_>>()
    };

    segments.sort_by(|left, right| left.started_at.cmp(&right.started_at));
    segments
}

fn metrics_for_today(
    state: &RuntimeState,
    current_session: Option<QueuedSession>,
    now: DateTime<Utc>,
) -> (i64, i64) {
    let time_zone = parse_time_zone(&state.time_zone);
    let (day_start, day_end) = local_day_bounds(time_zone, now);

    if let Some(snapshot) = valid_server_snapshot(state, now) {
        let local_overlay = local_overlay_sessions(state, current_session, snapshot, now);
        let local_focused_secs = local_overlay
            .iter()
            .filter_map(|session| slice_session_for_day(session, day_start, day_end))
            .map(|session| session.duration_secs)
            .sum::<i64>();
        let local_work_secs = local_overlay
            .iter()
            .filter(|session| counts_toward_work_hours(session))
            .filter_map(|session| slice_session_for_day(session, day_start, day_end))
            .map(|session| session.duration_secs)
            .sum::<i64>();

        return (
            snapshot.focused_secs + local_focused_secs,
            snapshot.work_hours_secs + local_work_secs,
        );
    }

    let sessions = merged_sessions_for_display(state, current_session, now);
    let focused_secs = sessions
        .iter()
        .filter_map(|session| slice_session_for_day(session, day_start, day_end))
        .map(|session| session.duration_secs)
        .sum::<i64>();
    let work_secs = sessions
        .iter()
        .filter(|session| counts_toward_work_hours(session))
        .filter_map(|session| slice_session_for_day(session, day_start, day_end))
        .map(|session| session.duration_secs)
        .sum::<i64>();

    (focused_secs, work_secs)
}

fn merged_sessions_for_display(
    state: &RuntimeState,
    current_session: Option<QueuedSession>,
    now: DateTime<Utc>,
) -> Vec<QueuedSession> {
    let expected_date = local_date_string(parse_time_zone(&state.time_zone), now);
    let mut sessions = match &state.server_day_snapshot {
        Some(snapshot)
            if snapshot.date == expected_date && snapshot.time_zone == state.time_zone =>
        {
            snapshot.sessions.clone()
        }
        _ => state.outbox.recent_sessions.clone(),
    };

    for session in &state.outbox.recent_sessions {
        merge_session(&mut sessions, session.clone());
    }

    if let Some(current_session) = current_session {
        merge_session(&mut sessions, current_session);
    }

    sessions
}

fn valid_server_snapshot<'a>(
    state: &'a RuntimeState,
    now: DateTime<Utc>,
) -> Option<&'a ServerDaySnapshot> {
    let expected_date = local_date_string(parse_time_zone(&state.time_zone), now);
    match &state.server_day_snapshot {
        Some(snapshot) if snapshot.date == expected_date && snapshot.time_zone == state.time_zone => {
            Some(snapshot)
        }
        _ => None,
    }
}

fn local_overlay_sessions(
    state: &RuntimeState,
    current_session: Option<QueuedSession>,
    snapshot: &ServerDaySnapshot,
    now: DateTime<Utc>,
) -> Vec<QueuedSession> {
    let expected_date = local_date_string(parse_time_zone(&state.time_zone), now);
    let mut snapshot_ids = snapshot
        .sessions
        .iter()
        .map(|session| session.source_session_id.as_str())
        .collect::<std::collections::HashSet<_>>();

    let mut overlay = Vec::new();
    for session in &state.outbox.queued_sessions {
        if !snapshot_ids.contains(session.source_session_id.as_str()) {
            overlay.push(session.clone());
            snapshot_ids.insert(session.source_session_id.as_str());
        }
    }

    if let Some(session) = current_session {
        let session_date = local_date_string(parse_time_zone(&state.time_zone), session.ended_at);
        if session_date == expected_date && !snapshot_ids.contains(session.source_session_id.as_str())
        {
            overlay.push(session);
        }
    }

    overlay
}

fn merge_session(sessions: &mut Vec<QueuedSession>, next: QueuedSession) {
    if let Some(existing) = sessions
        .iter_mut()
        .find(|session| session.source_session_id == next.source_session_id)
    {
        *existing = next;
    } else {
        sessions.push(next);
    }
}

fn parse_time_zone(name: &str) -> Tz {
    name.parse::<Tz>().unwrap_or(chrono_tz::UTC)
}

fn local_day_bounds(time_zone: Tz, now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>) {
    let now_local = now.with_timezone(&time_zone);
    let local_date = now_local.date_naive();
    let naive_start = local_date
        .and_hms_opt(0, 0, 0)
        .expect("midnight should always be valid");
    let day_start = match time_zone.from_local_datetime(&naive_start) {
        LocalResult::Single(value) => value.with_timezone(&Utc),
        LocalResult::Ambiguous(first, _) => first.with_timezone(&Utc),
        LocalResult::None => (now_local - Duration::hours(12))
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .and_then(|value| time_zone.from_local_datetime(&value).earliest())
            .expect("timezone should resolve a day boundary")
            .with_timezone(&Utc),
    };

    (day_start, day_start + Duration::days(1))
}

pub fn local_date_string(time_zone: Tz, now: DateTime<Utc>) -> String {
    now.with_timezone(&time_zone).format("%Y-%m-%d").to_string()
}

fn slice_session_for_day(
    session: &QueuedSession,
    day_start: DateTime<Utc>,
    day_end: DateTime<Utc>,
) -> Option<TimelineSegment> {
    let started_at = session.started_at.max(day_start);
    let ended_at = session.ended_at.min(day_end);
    if ended_at <= started_at {
        return None;
    }

    Some(TimelineSegment {
        source_session_id: session.source_session_id.clone(),
        app_name: session.app_name.clone(),
        window_title: session.window_title.clone(),
        started_at: started_at.to_rfc3339(),
        ended_at: ended_at.to_rfc3339(),
        start_offset_secs: (started_at - day_start).num_seconds().max(0),
        duration_secs: (ended_at - started_at).num_seconds().max(1),
        span_secs: (ended_at - started_at).num_seconds().max(1),
        interruption_count: 0,
    })
}

fn remote_display_session_to_timeline_segment(
    session: &RemoteDisplaySession,
    day_start: DateTime<Utc>,
    day_end: DateTime<Utc>,
) -> Option<TimelineSegment> {
    let started_at = chrono::DateTime::parse_from_rfc3339(&session.started_at)
        .ok()?
        .with_timezone(&Utc)
        .max(day_start);
    let ended_at = chrono::DateTime::parse_from_rfc3339(&session.ended_at)
        .ok()?
        .with_timezone(&Utc)
        .min(day_end);

    if ended_at <= started_at {
        return None;
    }

    Some(TimelineSegment {
        source_session_id: session.source_session_id.clone(),
        app_name: session.app_name.clone(),
        window_title: session.window_title.clone(),
        started_at: started_at.to_rfc3339(),
        ended_at: ended_at.to_rfc3339(),
        start_offset_secs: (started_at - day_start).num_seconds().max(0),
        duration_secs: session.focused_secs.max(1),
        span_secs: session
            .span_secs
            .max(session.focused_secs)
            .max(session.duration_secs)
            .max(1),
        interruption_count: session.interruption_count.max(0),
    })
}

fn default_settings() -> PersistedSettings {
    PersistedSettings {
        base_url: std::env::var("FOCUS_COLLECTOR_BASE_URL")
            .unwrap_or_else(|_| "https://second-brain-self-alpha.vercel.app".into()),
        api_key: std::env::var("FOCUS_COLLECTOR_API_KEY")
            .or_else(|_| std::env::var("FOCUS_INGEST_API_KEY"))
            .unwrap_or_default(),
        time_zone: std::env::var("FOCUS_COLLECTOR_TIME_ZONE").unwrap_or_else(|_| "UTC".into()),
        sample_interval_secs: std::env::var("FOCUS_COLLECTOR_SAMPLE_INTERVAL_SECS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(5),
        upload_interval_secs: std::env::var("FOCUS_COLLECTOR_UPLOAD_INTERVAL_SECS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(120),
    }
}

pub fn should_auto_upload(state: &RuntimeState, now: DateTime<Utc>) -> bool {
    if state.outbox.queued_sessions.is_empty() {
        return false;
    }

    let threshold_secs = state.upload_interval_secs.max(1) as i64;
    let baseline = state.last_upload_at.unwrap_or_else(|| {
        state
            .outbox
            .queued_sessions
            .iter()
            .map(|session| session.ended_at)
            .min()
            .unwrap_or(now)
    });

    (now - baseline).num_seconds() >= threshold_secs
}

fn load_settings(path: &PathBuf) -> Option<PersistedSettings> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<PersistedSettings>(&content).ok())
}

fn save_settings(path: &PathBuf, settings: &PersistedSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create settings directory: {error}"))?;
    }

    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("failed to serialize settings: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("failed to write settings: {error}"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use chrono::{TimeZone, Utc};

    use super::{
        build_status_at, default_settings, load_settings, save_settings, should_auto_upload,
        PersistedSettings, RuntimeState, ServerDaySnapshot,
    };
    use crate::{
        outbox::OutboxState,
        sessionizer::{FocusSessionizer, QueuedSession, WindowSample},
        status_sync::RemoteDisplaySession,
    };

    fn unique_temp_file(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("focus-tracker-{name}-{nanos}.json"))
    }

    #[test]
    fn settings_round_trip_to_disk() {
        let path = unique_temp_file("settings");
        let settings = PersistedSettings {
            base_url: "https://second-brain.test".into(),
            api_key: "secret-key".into(),
            time_zone: "Asia/Singapore".into(),
            sample_interval_secs: 9,
            upload_interval_secs: 120,
        };

        save_settings(&path, &settings).expect("settings should save");
        let loaded = load_settings(&path).expect("settings should load");

        assert_eq!(loaded, settings);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn default_settings_fall_back_without_env() {
        let settings = default_settings();

        assert_eq!(settings.base_url, "https://second-brain-self-alpha.vercel.app");
        assert_eq!(settings.time_zone, "UTC");
        assert_eq!(settings.sample_interval_secs, 5);
        assert_eq!(settings.upload_interval_secs, 120);
    }

    #[test]
    fn build_status_reports_today_focus_and_tracking_state() {
        let now = Utc.with_ymd_and_hms(2026, 3, 29, 10, 0, 0).unwrap();
        let outbox = OutboxState {
            device_id: "device-1".into(),
            recent_sessions: vec![QueuedSession {
                source_session_id: "session-1".into(),
                app_name: "Visual Studio Code".into(),
                window_title: Some("tracker.rs".into()),
                started_at: Utc.with_ymd_and_hms(2026, 3, 29, 8, 0, 0).unwrap(),
                ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 30, 0).unwrap(),
                duration_secs: 5400,
            }, QueuedSession {
                source_session_id: "queued-session-1".into(),
                app_name: "Linear".into(),
                window_title: Some("Focus bug".into()),
                started_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 31, 0).unwrap(),
                ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 35, 0).unwrap(),
                duration_secs: 240,
            }],
            queued_sessions: vec![QueuedSession {
                source_session_id: "queued-session-1".into(),
                app_name: "Linear".into(),
                window_title: Some("Focus bug".into()),
                started_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 31, 0).unwrap(),
                ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 35, 0).unwrap(),
                duration_secs: 240,
            }],
        };
        let mut sessionizer = FocusSessionizer::new(300);
        let started_at = Utc.with_ymd_and_hms(2026, 3, 29, 9, 40, 0).unwrap();
        sessionizer.observe(
            Some(WindowSample {
                app_name: "Google Chrome".into(),
                window_title: Some("Focus dashboard".into()),
            }),
            started_at,
            0,
        );
        sessionizer.observe(
            Some(WindowSample {
                app_name: "Google Chrome".into(),
                window_title: Some("Focus dashboard".into()),
            }),
            now,
            0,
        );

        let runtime = RuntimeState {
            sessionizer,
            outbox_path: unique_temp_file("outbox"),
            settings_path: unique_temp_file("settings"),
            outbox,
            server_day_snapshot: None,
            base_url: "http://127.0.0.1:3200".into(),
            api_key: "key".into(),
            time_zone: "Asia/Singapore".into(),
            sample_interval_secs: 5,
            upload_interval_secs: 120,
            last_upload_at: None,
            last_upload_message: Some("ok".into()),
            last_collected_at: None,
        };

        let status = build_status_at(&runtime, now);

        assert!(status.tracking_enabled);
        assert_eq!(status.today_focused_secs, 6_840);
        assert_eq!(status.today_work_secs, 6_600);
        assert_eq!(status.timeline_segments.len(), 3);
    }

    #[test]
    fn build_status_slices_cross_midnight_sessions_by_local_day() {
        let runtime = RuntimeState {
            sessionizer: FocusSessionizer::new(300),
            outbox_path: unique_temp_file("outbox"),
            settings_path: unique_temp_file("settings"),
            outbox: OutboxState {
                device_id: "device-2".into(),
                recent_sessions: vec![QueuedSession {
                    source_session_id: "session-2".into(),
                    app_name: "Notion".into(),
                    window_title: Some("Daily review".into()),
                    started_at: Utc.with_ymd_and_hms(2026, 3, 28, 15, 50, 0).unwrap(),
                    ended_at: Utc.with_ymd_and_hms(2026, 3, 28, 16, 20, 0).unwrap(),
                    duration_secs: 1800,
                }],
                queued_sessions: vec![QueuedSession {
                    source_session_id: "session-2".into(),
                    app_name: "Notion".into(),
                    window_title: Some("Daily review".into()),
                    started_at: Utc.with_ymd_and_hms(2026, 3, 28, 15, 50, 0).unwrap(),
                    ended_at: Utc.with_ymd_and_hms(2026, 3, 28, 16, 20, 0).unwrap(),
                    duration_secs: 1800,
                }],
            },
            server_day_snapshot: None,
            base_url: "http://127.0.0.1:3200".into(),
            api_key: String::new(),
            time_zone: "Asia/Singapore".into(),
            sample_interval_secs: 5,
            upload_interval_secs: 120,
            last_upload_at: None,
            last_upload_message: None,
            last_collected_at: None,
        };

        let status = build_status_at(
            &runtime,
            Utc.with_ymd_and_hms(2026, 3, 29, 1, 0, 0).unwrap(),
        );

        assert_eq!(status.today_focused_secs, 1_200);
        assert_eq!(status.today_work_secs, 1_200);
        assert_eq!(status.timeline_segments.len(), 1);
        assert_eq!(status.timeline_segments[0].duration_secs, 1_200);
    }

    #[test]
    fn auto_upload_waits_for_batch_window() {
        let queued_session = QueuedSession {
            source_session_id: "session-3".into(),
            app_name: "Google Chrome".into(),
            window_title: Some("docs".into()),
            started_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap(),
            ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 20).unwrap(),
            duration_secs: 20,
        };

        let mut runtime = RuntimeState {
            sessionizer: FocusSessionizer::new(300),
            outbox_path: unique_temp_file("outbox"),
            settings_path: unique_temp_file("settings"),
            outbox: OutboxState {
                device_id: "device-3".into(),
                recent_sessions: vec![queued_session.clone()],
                queued_sessions: vec![queued_session],
            },
            server_day_snapshot: None,
            base_url: "http://127.0.0.1:3200".into(),
            api_key: "token".into(),
            time_zone: "UTC".into(),
            sample_interval_secs: 5,
            upload_interval_secs: 120,
            last_upload_at: None,
            last_upload_message: None,
            last_collected_at: None,
        };

        assert!(!should_auto_upload(
            &runtime,
            Utc.with_ymd_and_hms(2026, 3, 29, 9, 1, 59).unwrap()
        ));
        assert!(should_auto_upload(
            &runtime,
            Utc.with_ymd_and_hms(2026, 3, 29, 9, 2, 20).unwrap()
        ));

        runtime.last_upload_at = Some(Utc.with_ymd_and_hms(2026, 3, 29, 9, 2, 20).unwrap());

        assert!(!should_auto_upload(
            &runtime,
            Utc.with_ymd_and_hms(2026, 3, 29, 9, 3, 0).unwrap()
        ));
        assert!(should_auto_upload(
            &runtime,
            Utc.with_ymd_and_hms(2026, 3, 29, 9, 4, 21).unwrap()
        ));
    }

    #[test]
    fn build_status_keeps_uploaded_history_in_today_total() {
        let runtime = RuntimeState {
            sessionizer: FocusSessionizer::new(300),
            outbox_path: unique_temp_file("outbox"),
            settings_path: unique_temp_file("settings"),
            outbox: OutboxState {
                device_id: "device-4".into(),
                recent_sessions: vec![QueuedSession {
                    source_session_id: "uploaded-1".into(),
                    app_name: "Google Meet".into(),
                    window_title: Some("Weekly sync".into()),
                    started_at: Utc.with_ymd_and_hms(2026, 3, 29, 10, 0, 0).unwrap(),
                    ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 10, 45, 0).unwrap(),
                    duration_secs: 2700,
                }],
                queued_sessions: Vec::new(),
            },
            server_day_snapshot: None,
            base_url: "http://127.0.0.1:3200".into(),
            api_key: "token".into(),
            time_zone: "Asia/Singapore".into(),
            sample_interval_secs: 5,
            upload_interval_secs: 120,
            last_upload_at: Some(Utc.with_ymd_and_hms(2026, 3, 29, 10, 46, 0).unwrap()),
            last_upload_message: Some("Uploaded 1 session".into()),
            last_collected_at: None,
        };

        let status = build_status_at(
            &runtime,
            Utc.with_ymd_and_hms(2026, 3, 29, 11, 0, 0).unwrap(),
        );

        assert_eq!(status.today_focused_secs, 2700);
        assert_eq!(status.today_work_secs, 2700);
        assert_eq!(status.timeline_segments.len(), 1);
    }

    #[test]
    fn build_status_prefers_server_snapshot_when_available() {
        let runtime = RuntimeState {
            sessionizer: FocusSessionizer::new(300),
            outbox_path: unique_temp_file("outbox"),
            settings_path: unique_temp_file("settings"),
            outbox: OutboxState {
                device_id: "device-5".into(),
                recent_sessions: vec![QueuedSession {
                    source_session_id: "local-1".into(),
                    app_name: "Finder".into(),
                    window_title: None,
                    started_at: Utc.with_ymd_and_hms(2026, 3, 29, 8, 0, 0).unwrap(),
                    ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 8, 1, 0).unwrap(),
                    duration_secs: 60,
                }],
                queued_sessions: Vec::new(),
            },
            server_day_snapshot: Some(ServerDaySnapshot {
                date: "2026-03-29".into(),
                time_zone: "Asia/Singapore".into(),
                focused_secs: 5400,
                work_hours_secs: 5400,
                sessions: vec![QueuedSession {
                    source_session_id: "remote-1".into(),
                    app_name: "Visual Studio Code".into(),
                    window_title: Some("focus.ts".into()),
                    started_at: Utc.with_ymd_and_hms(2026, 3, 29, 8, 0, 0).unwrap(),
                    ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 30, 0).unwrap(),
                    duration_secs: 5400,
                }],
                display_sessions: vec![RemoteDisplaySession {
                    source_session_id: "display-remote-1".into(),
                    app_name: "Visual Studio Code".into(),
                    window_title: Some("focus.ts".into()),
                    started_at: Utc
                        .with_ymd_and_hms(2026, 3, 29, 8, 0, 0)
                        .unwrap()
                        .to_rfc3339(),
                    ended_at: Utc
                        .with_ymd_and_hms(2026, 3, 29, 9, 30, 0)
                        .unwrap()
                        .to_rfc3339(),
                    duration_secs: 5400,
                    focused_secs: 5400,
                    span_secs: 5400,
                    interruption_count: 0,
                }],
                fetched_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 31, 0).unwrap(),
            }),
            base_url: "http://127.0.0.1:3200".into(),
            api_key: "token".into(),
            time_zone: "Asia/Singapore".into(),
            sample_interval_secs: 5,
            upload_interval_secs: 120,
            last_upload_at: None,
            last_upload_message: None,
            last_collected_at: None,
        };

        let status = build_status_at(
            &runtime,
            Utc.with_ymd_and_hms(2026, 3, 29, 10, 0, 0).unwrap(),
        );

        assert_eq!(status.today_focused_secs, 5400);
        assert_eq!(status.today_work_secs, 5400);
        assert_eq!(status.timeline_segments.len(), 1);
    }

    #[test]
    fn build_status_does_not_readd_recent_history_once_snapshot_exists() {
        let runtime = RuntimeState {
            sessionizer: FocusSessionizer::new(300),
            outbox_path: unique_temp_file("outbox"),
            settings_path: unique_temp_file("settings"),
            outbox: OutboxState {
                device_id: "device-6".into(),
                recent_sessions: vec![QueuedSession {
                    source_session_id: "local-history-1".into(),
                    app_name: "WeChat".into(),
                    window_title: Some("Weixin".into()),
                    started_at: Utc.with_ymd_and_hms(2026, 3, 29, 12, 0, 0).unwrap(),
                    ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 14, 0, 0).unwrap(),
                    duration_secs: 7200,
                }],
                queued_sessions: Vec::new(),
            },
            server_day_snapshot: Some(ServerDaySnapshot {
                date: "2026-03-29".into(),
                time_zone: "Asia/Singapore".into(),
                focused_secs: 21_138,
                work_hours_secs: 21_138,
                sessions: vec![QueuedSession {
                    source_session_id: "remote-1".into(),
                    app_name: "Visual Studio Code".into(),
                    window_title: Some("focus.ts".into()),
                    started_at: Utc.with_ymd_and_hms(2026, 3, 29, 8, 0, 0).unwrap(),
                    ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 13, 52, 18).unwrap(),
                    duration_secs: 21_138,
                }],
                display_sessions: vec![RemoteDisplaySession {
                    source_session_id: "display-remote-1".into(),
                    app_name: "Visual Studio Code".into(),
                    window_title: Some("focus.ts".into()),
                    started_at: Utc
                        .with_ymd_and_hms(2026, 3, 29, 8, 0, 0)
                        .unwrap()
                        .to_rfc3339(),
                    ended_at: Utc
                        .with_ymd_and_hms(2026, 3, 29, 13, 52, 18)
                        .unwrap()
                        .to_rfc3339(),
                    duration_secs: 21_138,
                    focused_secs: 21_138,
                    span_secs: 21_138,
                    interruption_count: 0,
                }],
                fetched_at: Utc.with_ymd_and_hms(2026, 3, 29, 14, 0, 0).unwrap(),
            }),
            base_url: "http://127.0.0.1:3200".into(),
            api_key: "token".into(),
            time_zone: "Asia/Singapore".into(),
            sample_interval_secs: 5,
            upload_interval_secs: 120,
            last_upload_at: None,
            last_upload_message: None,
            last_collected_at: None,
        };

        let status = build_status_at(
            &runtime,
            Utc.with_ymd_and_hms(2026, 3, 29, 14, 5, 0).unwrap(),
        );

        assert_eq!(status.today_focused_secs, 21_138);
        assert_eq!(status.today_work_secs, 21_138);
        assert_eq!(status.timeline_segments.len(), 1);
    }
}
