use std::process::Command;

use crate::sessionizer::WindowSample;

fn run_applescript(script: &str) -> Result<String, String> {
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("failed to run osascript: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn get_idle_seconds() -> i64 {
    run_applescript(r#"tell application "System Events" to get idle time"#)
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
}

pub fn get_active_window_sample() -> Option<WindowSample> {
    let app_name = run_applescript(
        r#"tell application "System Events" to get name of first application process whose frontmost is true"#,
    )
    .ok()?;

    if app_name.is_empty() {
        return None;
    }

    let window_title = run_applescript(
        r#"tell application "System Events" to get name of front window of (first application process whose frontmost is true)"#,
    )
    .ok()
    .filter(|value| !value.is_empty());

    Some(WindowSample {
        app_name,
        window_title,
    })
}
