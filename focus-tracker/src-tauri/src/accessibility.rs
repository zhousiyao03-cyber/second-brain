use std::process::Command;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

pub fn is_accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

pub fn get_browser_url(app_name: &str, _pid: i32) -> Option<String> {
    if !is_browser(app_name) || !is_accessibility_trusted() {
        return None;
    }

    let script = match app_name.to_ascii_lowercase().as_str() {
        "google chrome" | "chromium" | "microsoft edge" | "brave browser" | "arc" => {
            format!(r#"tell application "{app_name}" to get URL of active tab of front window"#)
        }
        "safari" => format!(r#"tell application "{app_name}" to get URL of front document"#),
        "firefox" => return None,
        _ => return None,
    };

    run_applescript(&script).filter(|url| !url.trim().is_empty())
}

fn run_applescript(script: &str) -> Option<String> {
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn is_browser(app_name: &str) -> bool {
    matches!(
        app_name.to_ascii_lowercase().as_str(),
        "google chrome"
            | "safari"
            | "arc"
            | "firefox"
            | "brave browser"
            | "microsoft edge"
            | "chromium"
    )
}
