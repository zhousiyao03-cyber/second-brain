use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::sessionizer::QueuedSession;

const MERGE_GAP_SECS: i64 = 120;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxState {
    pub device_id: String,
    #[serde(default)]
    pub recent_sessions: Vec<QueuedSession>,
    #[serde(default)]
    pub queued_sessions: Vec<QueuedSession>,
}

impl Default for OutboxState {
    fn default() -> Self {
        Self {
            device_id: Uuid::new_v4().to_string(),
            recent_sessions: Vec::new(),
            queued_sessions: Vec::new(),
        }
    }
}

const MAX_RECENT_SESSIONS: usize = 2_000;

impl OutboxState {
    pub fn record_session(&mut self, session: QueuedSession) {
        push_or_merge_session(&mut self.recent_sessions, session.clone());
        if self.recent_sessions.len() > MAX_RECENT_SESSIONS {
            let excess = self.recent_sessions.len() - MAX_RECENT_SESSIONS;
            self.recent_sessions.drain(0..excess);
        }

        push_or_merge_session(&mut self.queued_sessions, session);
    }
}

fn push_or_merge_session(target: &mut Vec<QueuedSession>, session: QueuedSession) {
    if target
        .iter()
        .any(|existing| existing.source_session_id == session.source_session_id)
    {
        return;
    }

    if let Some(last) = target.last_mut() {
        if should_merge_sessions(last, &session) {
            last.ended_at = last.ended_at.max(session.ended_at);
            last.duration_secs = (last.ended_at - last.started_at).num_seconds().max(1);
            if last.window_title.is_none() {
                last.window_title = session.window_title;
            }
            return;
        }
    }

    target.push(session);
}

fn should_merge_sessions(left: &QueuedSession, right: &QueuedSession) -> bool {
    let gap_secs = (right.started_at - left.ended_at).num_seconds();
    if gap_secs < 0 || gap_secs > MERGE_GAP_SECS {
        return false;
    }

    if left.app_name == right.app_name {
        return true;
    }

    matches!(
        (task_group(left), task_group(right)),
        (Some(left_group), Some(right_group))
            if left_group == right_group && is_mergeable_task_group(left_group)
    )
}

fn is_mergeable_task_group(group: &str) -> bool {
    matches!(group, "coding" | "research" | "design" | "writing")
}

pub(crate) fn counts_toward_work_hours(session: &QueuedSession) -> bool {
    matches!(
        task_group(session),
        Some("coding" | "research" | "design" | "writing" | "meeting" | "communication")
    )
}

pub(crate) fn task_group(session: &QueuedSession) -> Option<&'static str> {
    let haystack = format!(
        "{} {}",
        session.app_name,
        session.window_title.clone().unwrap_or_default()
    )
    .to_ascii_lowercase();

    if haystack.contains("code")
        || haystack.contains("cursor")
        || haystack.contains("terminal")
        || haystack.contains("ghostty")
        || haystack.contains("warp")
        || haystack.contains("iterm")
        || haystack.contains("xcode")
        || haystack.contains("postman")
        || haystack.contains("insomnia")
        || haystack.contains("localhost")
        || haystack.contains("github")
        || haystack.contains("gitlab")
        || haystack.contains("docs")
        || haystack.contains("reference")
        || haystack.contains("stackoverflow")
    {
        return Some("coding");
    }

    if haystack.contains("figma")
        || haystack.contains("sketch")
        || haystack.contains("framer")
    {
        return Some("design");
    }

    if haystack.contains("zoom")
        || haystack.contains("meet")
        || haystack.contains("teams")
        || haystack.contains("calendar")
    {
        return Some("meeting");
    }

    if haystack.contains("slack")
        || haystack.contains("discord")
        || haystack.contains("mail")
        || haystack.contains("gmail")
        || haystack.contains("wechat")
        || haystack.contains("feishu")
        || haystack.contains("lark")
    {
        return Some("communication");
    }

    if haystack.contains("notion")
        || haystack.contains("draft")
        || haystack.contains("word")
    {
        return Some("writing");
    }

    if haystack.contains("chrome")
        || haystack.contains("safari")
        || haystack.contains("arc")
        || haystack.contains("firefox")
    {
        return Some("research");
    }

    None
}

pub fn load_outbox(path: &PathBuf) -> OutboxState {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<OutboxState>(&content).ok())
        .unwrap_or_default()
}

pub fn save_outbox(path: &PathBuf, state: &OutboxState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create outbox directory: {error}"))?;
    }

    let content = serde_json::to_string_pretty(state)
        .map_err(|error| format!("failed to serialize outbox: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("failed to write outbox: {error}"))
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::OutboxState;
    use crate::sessionizer::QueuedSession;

    fn session(
        id: &str,
        app_name: &str,
        window_title: Option<&str>,
        started_at: &str,
        ended_at: &str,
    ) -> QueuedSession {
        let started = chrono::DateTime::parse_from_rfc3339(started_at)
            .expect("valid start")
            .with_timezone(&Utc);
        let ended = chrono::DateTime::parse_from_rfc3339(ended_at)
            .expect("valid end")
            .with_timezone(&Utc);
        QueuedSession {
            source_session_id: id.into(),
            app_name: app_name.into(),
            window_title: window_title.map(str::to_string),
            started_at: started,
            ended_at: ended,
            duration_secs: (ended - started).num_seconds(),
        }
    }

    #[test]
    fn merges_adjacent_same_app_sessions() {
        let mut outbox = OutboxState::default();
        outbox.record_session(session(
            "session-a",
            "Visual Studio Code",
            Some("index.ts"),
            "2026-03-29T09:00:00Z",
            "2026-03-29T09:20:00Z",
        ));
        outbox.record_session(session(
            "session-b",
            "Visual Studio Code",
            Some("index.ts"),
            "2026-03-29T09:21:00Z",
            "2026-03-29T09:40:00Z",
        ));

        assert_eq!(outbox.queued_sessions.len(), 1);
        assert_eq!(outbox.queued_sessions[0].duration_secs, 40 * 60);
    }

    #[test]
    fn merges_adjacent_coding_workflow_sessions() {
        let mut outbox = OutboxState::default();
        outbox.record_session(session(
            "session-a",
            "Visual Studio Code",
            Some("index.ts"),
            "2026-03-29T09:00:00Z",
            "2026-03-29T09:20:00Z",
        ));
        outbox.record_session(session(
            "session-b",
            "Google Chrome",
            Some("Next.js docs"),
            "2026-03-29T09:20:30Z",
            "2026-03-29T09:35:00Z",
        ));

        assert_eq!(outbox.queued_sessions.len(), 1);
        assert_eq!(outbox.queued_sessions[0].app_name, "Visual Studio Code");
        assert_eq!(outbox.queued_sessions[0].duration_secs, 35 * 60);
    }

    #[test]
    fn keeps_distinct_sessions_when_gap_is_large() {
        let mut outbox = OutboxState::default();
        outbox.record_session(session(
            "session-a",
            "Visual Studio Code",
            Some("index.ts"),
            "2026-03-29T09:00:00Z",
            "2026-03-29T09:20:00Z",
        ));
        outbox.record_session(session(
            "session-b",
            "Google Chrome",
            Some("Next.js docs"),
            "2026-03-29T09:25:00Z",
            "2026-03-29T09:35:00Z",
        ));

        assert_eq!(outbox.queued_sessions.len(), 2);
    }
}
