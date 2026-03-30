use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const SWITCH_CONFIRMATION_SECS: i64 = 3;
const MIN_SESSION_SECS: i64 = 5;
const LOW_PRIORITY_IGNORE_SECS: i64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnrichedSample {
    pub app_name: String,
    pub window_title: Option<String>,
    #[serde(default)]
    pub browser_url: Option<String>,
    #[serde(default)]
    pub browser_page_title: Option<String>,
    #[serde(default)]
    pub visible_apps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSession {
    pub source_session_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    #[serde(default)]
    pub browser_url: Option<String>,
    #[serde(default)]
    pub browser_page_title: Option<String>,
    #[serde(default)]
    pub visible_apps: Vec<String>,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_secs: i64,
}

#[derive(Debug, Clone)]
struct ActiveSession {
    source_session_id: String,
    app_name: String,
    window_title: Option<String>,
    browser_url: Option<String>,
    browser_page_title: Option<String>,
    visible_apps: Vec<String>,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct PendingSwitch {
    sample: EnrichedSample,
    started_at: DateTime<Utc>,
}

#[derive(Debug)]
pub struct FocusSessionizer {
    idle_threshold_secs: i64,
    pending: Option<PendingSwitch>,
    current: Option<ActiveSession>,
}

impl FocusSessionizer {
    pub fn new(idle_threshold_secs: i64) -> Self {
        Self {
            idle_threshold_secs,
            pending: None,
            current: None,
        }
    }

    pub fn observe(
        &mut self,
        sample: Option<EnrichedSample>,
        observed_at: DateTime<Utc>,
        idle_secs: i64,
    ) -> Option<QueuedSession> {
        if sample.is_none() || idle_secs >= self.idle_threshold_secs {
            self.pending = None;
            return self.flush(observed_at);
        }

        let sample = sample.expect("sample already checked");

        if self.current.is_none() {
            self.observe_without_active(sample, observed_at);
            return None;
        }

        let current = self.current.as_mut().expect("session exists");
        let same_window =
            current.app_name == sample.app_name && current.window_title == sample.window_title;

        if same_window {
            current.browser_url = sample.browser_url;
            current.browser_page_title = sample.browser_page_title;
            current.visible_apps = sample.visible_apps;
            current.ended_at = observed_at;
            self.pending = None;
            return None;
        }

        self.observe_with_active(sample, observed_at)
    }

    pub fn flush(&mut self, observed_at: DateTime<Utc>) -> Option<QueuedSession> {
        self.pending = None;
        let current = self.current.take()?;
        let ended_at = if observed_at > current.started_at {
            observed_at
        } else {
            current.started_at
        };
        let duration_secs = (ended_at - current.started_at).num_seconds().max(1);

        self.finalize_closed(QueuedSession {
            source_session_id: current.source_session_id,
            app_name: current.app_name,
            window_title: current.window_title,
            browser_url: current.browser_url,
            browser_page_title: current.browser_page_title,
            visible_apps: current.visible_apps,
            started_at: current.started_at,
            ended_at,
            duration_secs,
        })
    }

    pub fn current_session_at(&self, observed_at: DateTime<Utc>) -> Option<QueuedSession> {
        let current = self.current.as_ref()?;
        let ended_at = if observed_at > current.ended_at {
            observed_at
        } else {
            current.ended_at
        };
        Some(QueuedSession {
            source_session_id: current.source_session_id.clone(),
            app_name: current.app_name.clone(),
            window_title: current.window_title.clone(),
            browser_url: current.browser_url.clone(),
            browser_page_title: current.browser_page_title.clone(),
            visible_apps: current.visible_apps.clone(),
            started_at: current.started_at,
            ended_at,
            duration_secs: (ended_at - current.started_at).num_seconds().max(1),
        })
    }

    fn observe_without_active(&mut self, sample: EnrichedSample, observed_at: DateTime<Utc>) {
        match &self.pending {
            Some(pending) if pending.sample == sample => {
                if (observed_at - pending.started_at).num_seconds() >= SWITCH_CONFIRMATION_SECS {
                    self.current = Some(ActiveSession {
                        source_session_id: create_source_session_id(&sample, pending.started_at),
                        app_name: sample.app_name,
                        window_title: sample.window_title,
                        browser_url: sample.browser_url,
                        browser_page_title: sample.browser_page_title,
                        visible_apps: sample.visible_apps,
                        started_at: pending.started_at,
                        ended_at: observed_at,
                    });
                    self.pending = None;
                }
            }
            _ => {
                self.pending = Some(PendingSwitch {
                    sample,
                    started_at: observed_at,
                });
            }
        }
    }

    fn observe_with_active(
        &mut self,
        sample: EnrichedSample,
        observed_at: DateTime<Utc>,
    ) -> Option<QueuedSession> {
        match &self.pending {
            Some(pending) if pending.sample == sample => {
                if (observed_at - pending.started_at).num_seconds() < SWITCH_CONFIRMATION_SECS {
                    return None;
                }

                let next_started_at = pending.started_at;
                let next_session = ActiveSession {
                    source_session_id: create_source_session_id(&sample, next_started_at),
                    app_name: sample.app_name,
                    window_title: sample.window_title,
                    browser_url: sample.browser_url,
                    browser_page_title: sample.browser_page_title,
                    visible_apps: sample.visible_apps,
                    started_at: next_started_at,
                    ended_at: observed_at,
                };
                let current = self.current.take().expect("session exists");
                let ended_at = if next_started_at > current.started_at {
                    next_started_at
                } else {
                    current.started_at
                };
                let closed = QueuedSession {
                    source_session_id: current.source_session_id,
                    app_name: current.app_name,
                    window_title: current.window_title,
                    browser_url: current.browser_url,
                    browser_page_title: current.browser_page_title,
                    visible_apps: current.visible_apps,
                    started_at: current.started_at,
                    ended_at,
                    duration_secs: (ended_at - current.started_at).num_seconds().max(1),
                };

                self.current = Some(next_session);
                self.pending = None;
                self.finalize_closed(closed)
            }
            _ => {
                self.pending = Some(PendingSwitch {
                    sample,
                    started_at: observed_at,
                });
                None
            }
        }
    }

    fn finalize_closed(&self, session: QueuedSession) -> Option<QueuedSession> {
        if session.duration_secs < MIN_SESSION_SECS {
            return None;
        }

        if session.duration_secs < LOW_PRIORITY_IGNORE_SECS && is_low_priority_app(&session.app_name)
        {
            return None;
        }

        Some(session)
    }
}

fn is_low_priority_app(app_name: &str) -> bool {
    matches!(
        app_name.trim().to_ascii_lowercase().as_str(),
        "finder"
            | "focus-tracker"
            | "rize"
            | "systemuiserver"
            | "control center"
            | "notificationcenter"
            | "spotlight"
            | "loginwindow"
    )
}

fn create_source_session_id(sample: &EnrichedSample, observed_at: DateTime<Utc>) -> String {
    let slug = format!(
        "{}:{}",
        sample.app_name,
        sample.window_title.clone().unwrap_or_default()
    )
    .to_lowercase()
    .chars()
    .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
    .collect::<String>()
    .trim_matches('-')
    .chars()
    .take(48)
    .collect::<String>();

    format!(
        "{}-{}",
        observed_at.to_rfc3339(),
        if slug.is_empty() {
            Uuid::new_v4().to_string()
        } else {
            slug
        }
    )
}

#[cfg(test)]
mod tests {
    use super::{EnrichedSample, FocusSessionizer};
    use chrono::{TimeZone, Utc};

    fn sample(app_name: &str, window_title: Option<&str>) -> EnrichedSample {
        EnrichedSample {
            app_name: app_name.into(),
            window_title: window_title.map(str::to_string),
            browser_url: None,
            browser_page_title: None,
            visible_apps: vec![],
        }
    }

    #[test]
    fn extends_current_session_for_same_window() {
        let mut sessionizer = FocusSessionizer::new(300);
        let first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
        let confirm = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 3).unwrap();
        let second = Utc.with_ymd_and_hms(2026, 3, 29, 9, 5, 0).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 3, 29, 9, 10, 0).unwrap();

        assert!(sessionizer
            .observe(Some(sample("Visual Studio Code", Some("auth.ts - second-brain"))), first, 0)
            .is_none());
        assert!(sessionizer
            .observe(
                Some(sample("Visual Studio Code", Some("auth.ts - second-brain"))),
                confirm,
                0,
            )
            .is_none());
        assert!(sessionizer
            .observe(
                Some(sample("Visual Studio Code", Some("auth.ts - second-brain"))),
                second,
                0,
            )
            .is_none());

        let closed = sessionizer.flush(end).expect("session should flush");
        assert_eq!(closed.app_name, "Visual Studio Code");
        assert_eq!(closed.window_title.as_deref(), Some("auth.ts - second-brain"));
        assert_eq!(closed.duration_secs, 10 * 60);
    }

    #[test]
    fn closes_previous_session_on_window_change() {
        let mut sessionizer = FocusSessionizer::new(300);
        let first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
        let confirm = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 3).unwrap();
        let switch_start = Utc.with_ymd_and_hms(2026, 3, 29, 9, 10, 0).unwrap();
        let switch_confirm = Utc.with_ymd_and_hms(2026, 3, 29, 9, 10, 3).unwrap();

        sessionizer.observe(Some(sample("Visual Studio Code", Some("auth.ts"))), first, 0);
        sessionizer.observe(Some(sample("Visual Studio Code", Some("auth.ts"))), confirm, 0);
        assert!(sessionizer
            .observe(Some(sample("Google Chrome", Some("Pull request"))), switch_start, 0)
            .is_none());

        let closed = sessionizer
            .observe(
                Some(sample("Google Chrome", Some("Pull request"))),
                switch_confirm,
                0,
            )
            .expect("previous session should close");
        assert_eq!(closed.app_name, "Visual Studio Code");
        assert_eq!(closed.duration_secs, 10 * 60);
    }

    #[test]
    fn ignores_switch_that_returns_before_confirmation_delay() {
        let mut sessionizer = FocusSessionizer::new(300);
        let first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
        let confirm = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 3).unwrap();
        let switch_start = Utc.with_ymd_and_hms(2026, 3, 29, 9, 10, 0).unwrap();
        let return_at = Utc.with_ymd_and_hms(2026, 3, 29, 9, 10, 2).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 3, 29, 9, 20, 0).unwrap();

        sessionizer.observe(Some(sample("Visual Studio Code", Some("auth.ts"))), first, 0);
        sessionizer.observe(Some(sample("Visual Studio Code", Some("auth.ts"))), confirm, 0);
        assert!(sessionizer
            .observe(Some(sample("Google Chrome", Some("Pull request"))), switch_start, 0)
            .is_none());
        assert!(sessionizer
            .observe(Some(sample("Visual Studio Code", Some("auth.ts"))), return_at, 0)
            .is_none());

        let closed = sessionizer.flush(end).expect("session should flush");
        assert_eq!(closed.app_name, "Visual Studio Code");
        assert_eq!(closed.duration_secs, 20 * 60);
    }

    #[test]
    fn ignores_sessions_shorter_than_minimum_duration() {
        let mut sessionizer = FocusSessionizer::new(300);
        let first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
        let confirm = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 3).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 4).unwrap();

        sessionizer.observe(Some(sample("Visual Studio Code", Some("auth.ts"))), first, 0);
        sessionizer.observe(Some(sample("Visual Studio Code", Some("auth.ts"))), confirm, 0);

        assert!(sessionizer.flush(end).is_none());
    }

    #[test]
    fn ignores_low_priority_apps_under_two_minutes() {
        let mut sessionizer = FocusSessionizer::new(300);
        let first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
        let confirm = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 3).unwrap();
        let end = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 20).unwrap();

        sessionizer.observe(Some(sample("Finder", Some("Downloads"))), first, 0);
        sessionizer.observe(Some(sample("Finder", Some("Downloads"))), confirm, 0);

        assert!(sessionizer.flush(end).is_none());
    }
}
