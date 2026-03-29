use reqwest::blocking::Client;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairDevicePayload<'a> {
    code: &'a str,
    device_id: &'a str,
    device_name: &'a str,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairDeviceResponse {
    pub device_name: String,
    pub token: String,
}

pub fn pair_device(
    base_url: &str,
    code: &str,
    device_id: &str,
    device_name: &str,
) -> Result<PairDeviceResponse, String> {
    let client = Client::new();
    let response = client
        .post(format!("{}/api/focus/pair", base_url.trim_end_matches('/')))
        .json(&PairDevicePayload {
            code,
            device_id,
            device_name,
        })
        .send()
        .map_err(|error| format!("pairing request failed: {error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("pairing failed with status {status}: {body}"));
    }

    response
        .json::<PairDeviceResponse>()
        .map_err(|error| format!("failed to decode pairing response: {error}"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::PairDevicePayload;

    #[test]
    fn serializes_pair_request_using_camel_case_api_fields() {
        let payload = serde_json::to_value(PairDevicePayload {
            code: "ABCD234XYZ",
            device_id: "device-1",
            device_name: "MacBook Focus Tracker",
        })
        .expect("payload should serialize");

        assert_eq!(
            payload,
            json!({
                "code": "ABCD234XYZ",
                "deviceId": "device-1",
                "deviceName": "MacBook Focus Tracker"
            })
        );
    }
}
