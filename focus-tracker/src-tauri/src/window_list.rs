use std::collections::HashSet;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct VisibleWindow {
    pub app_name: String,
    pub window_title: Option<String>,
    pub screen_index: u32,
    pub is_frontmost: bool,
}

pub fn get_visible_windows(frontmost_app: &str) -> Vec<VisibleWindow> {
    let script = r#"
set outputLines to {}
tell application "System Events"
  set visibleProcesses to every application process whose visible is true
  repeat with procRef in visibleProcesses
    set appName to name of procRef
    set titleText to ""
    try
      if (count of windows of procRef) > 0 then
        set titleText to name of front window of procRef
      end if
    end try
    set end of outputLines to appName & "||" & titleText
  end repeat
end tell
return outputLines as string
"#;

    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Vec::new();
    }

    let mut seen = HashSet::new();
    raw.split(", ")
        .filter_map(|entry| {
            let mut parts = entry.splitn(2, "||");
            let app_name = parts.next()?.trim().to_string();
            if app_name.is_empty() || !seen.insert(app_name.clone()) {
                return None;
            }

            let window_title = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);

            Some(VisibleWindow {
                is_frontmost: app_name == frontmost_app,
                app_name,
                window_title,
                screen_index: 0,
            })
        })
        .collect()
}
