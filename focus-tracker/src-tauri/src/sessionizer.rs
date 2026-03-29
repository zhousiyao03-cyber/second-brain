use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const SWITCH_CONFIRMATION_SECS: i64 = 10;
const MIN_SESSION_SECS: i64 = 30;
const LOW_PRIORITY_IGNORE_SECS: i64 = 120;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowSample {
    pub app_name: String,
    pub window_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSession {
    pub source_session_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_secs: i64,
}

#[derive(Debug, Clone)]
struct ActiveSession {
    source_session_id: String,
    app_name: String,
    window_title: Option<String>,
    started_at: DateTime<Utc>,
    ended_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct PendingSwitch {
    sample: WindowSample,
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
        sample: Option<WindowSample>,
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
            started_at: current.started_at,
            ended_at,
            duration_secs: (ended_at - current.started_at).num_seconds().max(1),
        })
    }

    fn observe_without_active(
        &mut self,
        sample: WindowSample,
        observed_at: DateTime<Utc>,
    ) {
        match &self.pending {
            Some(pending) if pending.sample == sample => {
                if (observed_at - pending.started_at).num_seconds() >= SWITCH_CONFIRMATION_SECS {
                    self.current = Some(ActiveSession {
                        source_session_id: create_source_session_id(&sample, pending.started_at),
                        app_name: sample.app_name,
                        window_title: sample.window_title,
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
        sample: WindowSample,
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

fn create_source_session_id(sample: &WindowSample, observed_at: DateTime<Utc>) -> String {
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
    use super::{FocusSessionizer, WindowSample};
    use chrono::{TimeZone, Utc};

    #[test]
    fn extends_current_session_for_same_window() {
      let mut sessionizer = FocusSessionizer::new(300);
      let first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
      let confirm = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 10).unwrap();
      let second = Utc.with_ymd_and_hms(2026, 3, 29, 9, 5, 0).unwrap();
      let end = Utc.with_ymd_and_hms(2026, 3, 29, 9, 10, 0).unwrap();

      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("auth.ts - second-brain".into()),
      }), first, 0).is_none());

      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("auth.ts - second-brain".into()),
      }), confirm, 0).is_none());

      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("auth.ts - second-brain".into()),
      }), second, 0).is_none());

      let closed = sessionizer.flush(end).expect("session should flush");
      assert_eq!(closed.duration_secs, 600);
    }

    #[test]
    fn closes_previous_session_on_window_change() {
      let mut sessionizer = FocusSessionizer::new(300);
      let first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
      let confirm_first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 10).unwrap();
      let second = Utc.with_ymd_and_hms(2026, 3, 29, 9, 7, 0).unwrap();
      let confirm_second = Utc.with_ymd_and_hms(2026, 3, 29, 9, 7, 10).unwrap();

      sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("auth.ts - second-brain".into()),
      }), first, 0);
      sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("auth.ts - second-brain".into()),
      }), confirm_first, 0);

      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Google Chrome".into(),
        window_title: Some("JWT docs".into()),
      }), second, 0).is_none());
      let closed = sessionizer.observe(Some(WindowSample {
        app_name: "Google Chrome".into(),
        window_title: Some("JWT docs".into()),
      }), confirm_second, 0).expect("previous session should close");

      assert_eq!(closed.app_name, "Visual Studio Code");
      assert_eq!(closed.duration_secs, 420);
    }

    #[test]
    fn ignores_switch_that_returns_before_confirmation_delay() {
      let mut sessionizer = FocusSessionizer::new(300);
      let start = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
      let confirmed = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 10).unwrap();
      let brief_switch = Utc.with_ymd_and_hms(2026, 3, 29, 9, 5, 0).unwrap();
      let switch_back = Utc.with_ymd_and_hms(2026, 3, 29, 9, 5, 5).unwrap();
      let end = Utc.with_ymd_and_hms(2026, 3, 29, 9, 10, 0).unwrap();

      sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("index.ts".into()),
      }), start, 0);
      sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("index.ts".into()),
      }), confirmed, 0);

      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Google Chrome".into(),
        window_title: Some("Docs".into()),
      }), brief_switch, 0).is_none());

      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("index.ts".into()),
      }), switch_back, 0).is_none());

      let closed = sessionizer.flush(end).expect("session should flush");
      assert_eq!(closed.app_name, "Visual Studio Code");
      assert_eq!(closed.duration_secs, 600);
    }

    #[test]
    fn ignores_sessions_shorter_than_minimum_duration() {
      let mut sessionizer = FocusSessionizer::new(300);
      let start = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
      let confirm_first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 10).unwrap();
      let switch = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 20).unwrap();
      let confirm_switch = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 30).unwrap();

      sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("index.ts".into()),
      }), start, 0);
      sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("index.ts".into()),
      }), confirm_first, 0);

      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Google Chrome".into(),
        window_title: Some("Docs".into()),
      }), switch, 0).is_none());
      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Google Chrome".into(),
        window_title: Some("Docs".into()),
      }), confirm_switch, 0).is_none());
    }

    #[test]
    fn ignores_low_priority_apps_under_two_minutes() {
      let mut sessionizer = FocusSessionizer::new(300);
      let start = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 0).unwrap();
      let confirm_first = Utc.with_ymd_and_hms(2026, 3, 29, 9, 0, 10).unwrap();
      let switch = Utc.with_ymd_and_hms(2026, 3, 29, 9, 10, 0).unwrap();
      let confirm_switch = Utc.with_ymd_and_hms(2026, 3, 29, 9, 10, 10).unwrap();
      let switch_back = Utc.with_ymd_and_hms(2026, 3, 29, 9, 11, 0).unwrap();
      let confirm_back = Utc.with_ymd_and_hms(2026, 3, 29, 9, 11, 10).unwrap();

      sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("index.ts".into()),
      }), start, 0);
      sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("index.ts".into()),
      }), confirm_first, 0);

      let first_closed = sessionizer.observe(Some(WindowSample {
        app_name: "Finder".into(),
        window_title: None,
      }), switch, 0);
      assert!(first_closed.is_none());

      let closed_main = sessionizer.observe(Some(WindowSample {
        app_name: "Finder".into(),
        window_title: None,
      }), confirm_switch, 0).expect("main session should close");
      assert_eq!(closed_main.app_name, "Visual Studio Code");

      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("index.ts".into()),
      }), switch_back, 0).is_none());
      assert!(sessionizer.observe(Some(WindowSample {
        app_name: "Visual Studio Code".into(),
        window_title: Some("index.ts".into()),
      }), confirm_back, 0).is_none());
    }
}
