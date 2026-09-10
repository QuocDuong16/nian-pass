use serde::Serialize;

/// Coarse, secret-free runtime classification for presentation routing.
#[derive(Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePlatform {
    Desktop,
    Android,
    Ios,
}

/// The complete platform bootstrap contract exposed to the WebView.
#[derive(Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfoDto {
    pub platform: RuntimePlatform,
    pub version: &'static str,
    pub commit: &'static str,
}

fn classify_target(is_android: bool, is_ios: bool) -> RuntimePlatform {
    if is_android {
        RuntimePlatform::Android
    } else if is_ios {
        RuntimePlatform::Ios
    } else {
        RuntimePlatform::Desktop
    }
}

impl RuntimeInfoDto {
    #[must_use]
    pub fn current() -> Self {
        Self {
            platform: classify_target(cfg!(target_os = "android"), cfg!(target_os = "ios")),
            version: env!("CARGO_PKG_VERSION"),
            commit: option_env!("NIAN_PASS_COMMIT").unwrap_or("unknown"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{RuntimeInfoDto, RuntimePlatform, classify_target};

    #[test]
    fn classifies_only_the_three_presentation_platforms() {
        assert!(classify_target(false, false) == RuntimePlatform::Desktop);
        assert!(classify_target(true, false) == RuntimePlatform::Android);
        assert!(classify_target(false, true) == RuntimePlatform::Ios);
    }

    #[test]
    fn runtime_contract_contains_only_the_platform_enum() {
        let encoded = serde_json::to_value(RuntimeInfoDto {
            platform: RuntimePlatform::Android,
            version: "0.1.0-rc.10",
            commit: "0123456789abcdef0123456789abcdef01234567",
        });
        assert!(matches!(
            encoded,
            Ok(value) if value == serde_json::json!({
                "platform": "android",
                "version": "0.1.0-rc.10",
                "commit": "0123456789abcdef0123456789abcdef01234567"
            })
        ));
    }

    #[test]
    fn current_runtime_uses_the_compile_time_host_target() {
        assert!(RuntimeInfoDto::current().platform == RuntimePlatform::Desktop);
    }
}
