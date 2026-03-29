use reqwest::blocking::Client;
use serde::Deserialize;

use crate::sessionizer::QueuedSession;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDisplaySession {
    pub source_session_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub started_at: String,
    pub ended_at: String,
    pub duration_secs: i64,
    pub focused_secs: i64,
    pub span_secs: i64,
    pub interruption_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDayStatus {
    pub date: String,
    pub time_zone: String,
    pub focused_secs: i64,
    pub work_hours_secs: i64,
    pub sessions: Vec<QueuedSession>,
    pub display_sessions: Vec<RemoteDisplaySession>,
    pub fetched_at: String,
}

pub fn fetch_remote_day_status(
    base_url: &str,
    api_key: &str,
    device_id: &str,
    time_zone: &str,
    date: &str,
) -> Result<RemoteDayStatus, String> {
    let client = Client::new();
    let response = client
        .get(format!("{}/api/focus/status", base_url.trim_end_matches('/')))
        .bearer_auth(api_key)
        .query(&[
            ("deviceId", device_id),
            ("timeZone", time_zone),
            ("date", date),
        ])
        .send()
        .map_err(|error| format!("status request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("status sync failed with status {status}: {body}"));
    }

    response
        .json::<RemoteDayStatus>()
        .map_err(|error| format!("failed to decode status response: {error}"))
}
