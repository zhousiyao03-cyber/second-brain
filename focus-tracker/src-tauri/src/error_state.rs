pub fn normalize_focus_runtime_error(message: &str) -> String {
    let lowered = message.to_ascii_lowercase();

    if lowered.contains("status 401")
        || lowered.contains("unauthorized")
        || lowered.contains("status 410")
        || lowered.contains("expired")
        || lowered.contains("revoked")
    {
        return "Desktop token is no longer valid. Generate a new pairing code in /focus and reconnect this collector.".into();
    }

    if lowered.contains("status 429") || lowered.contains("too many requests") {
        return "Pairing or upload is temporarily rate-limited. Wait a few minutes and try again.".into();
    }

    message.to_string()
}

#[cfg(test)]
mod tests {
    use super::normalize_focus_runtime_error;

    #[test]
    fn rewrites_invalid_token_errors_into_reconnect_guidance() {
        assert_eq!(
            normalize_focus_runtime_error("status sync failed with status 401 Unauthorized"),
            "Desktop token is no longer valid. Generate a new pairing code in /focus and reconnect this collector."
        );
        assert_eq!(
            normalize_focus_runtime_error("pairing failed with status 410: Pairing code expired"),
            "Desktop token is no longer valid. Generate a new pairing code in /focus and reconnect this collector."
        );
    }

    #[test]
    fn rewrites_rate_limit_errors_into_retry_guidance() {
        assert_eq!(
            normalize_focus_runtime_error("pairing failed with status 429: Too Many Requests"),
            "Pairing or upload is temporarily rate-limited. Wait a few minutes and try again."
        );
    }
}
