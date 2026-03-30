use reqwest::blocking::Client;
use serde::Serialize;

use crate::sessionizer::QueuedSession;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IngestPayload<'a> {
    device_id: &'a str,
    time_zone: &'a str,
    sessions: &'a [QueuedSession],
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResponse {
    pub accepted_count: usize,
    pub accepted: Vec<String>,
    pub rejected: Vec<RejectedSession>,
    pub time_zone: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct RejectedSession {
    pub source_session_id: String,
    pub reason: String,
}

pub fn upload_sessions(
    base_url: &str,
    api_key: &str,
    device_id: &str,
    time_zone: &str,
    sessions: &[QueuedSession],
) -> Result<IngestResponse, String> {
    let client = Client::new();
    let response = client
        .post(format!("{}/api/focus/ingest", base_url.trim_end_matches('/')))
        .bearer_auth(api_key)
        .json(&IngestPayload {
            device_id,
            time_zone,
            sessions,
        })
        .send()
        .map_err(|error| format!("upload request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("upload failed with status {status}: {body}"));
    }

    response
        .json::<IngestResponse>()
        .map_err(|error| format!("failed to decode upload response: {error}"))
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    use super::IngestPayload;
    use crate::sessionizer::QueuedSession;

    #[test]
    fn serializes_sessions_using_camel_case_api_fields() {
        let sessions = vec![QueuedSession {
            source_session_id: "session-1".into(),
            app_name: "Google Chrome".into(),
            window_title: Some("Go by Example".into()),
            browser_url: Some("https://gobyexample.com/goroutines".into()),
            browser_page_title: Some("Go by Example: Goroutines".into()),
            visible_apps: vec!["Visual Studio Code".into(), "Ghostty".into()],
            started_at: Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap(),
            ended_at: Utc.with_ymd_and_hms(2026, 3, 29, 10, 0, 0).unwrap(),
            duration_secs: 3600,
        }];

        let payload = serde_json::to_value(IngestPayload {
            device_id: "device-1",
            time_zone: "Asia/Singapore",
            sessions: &sessions,
        })
        .expect("payload should serialize");

        assert_eq!(
            payload,
            json!({
                "deviceId": "device-1",
                "timeZone": "Asia/Singapore",
                "sessions": [{
                    "sourceSessionId": "session-1",
                    "appName": "Google Chrome",
                    "windowTitle": "Go by Example",
                    "browserUrl": "https://gobyexample.com/goroutines",
                    "browserPageTitle": "Go by Example: Goroutines",
                    "visibleApps": ["Visual Studio Code", "Ghostty"],
                    "startedAt": "2026-03-29T09:00:00Z",
                    "endedAt": "2026-03-29T10:00:00Z",
                    "durationSecs": 3600
                }]
            })
        );
    }
}
