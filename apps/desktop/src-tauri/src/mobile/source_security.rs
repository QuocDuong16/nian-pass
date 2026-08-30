#![cfg(target_os = "android")]

use serde::{Deserialize, Serialize};

use super::{MobileError, source::AndroidVaultSource};

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeSecurityResponse {
    Ok {
        foreground: bool,
        #[serde(rename = "elapsedRealtimeMs")]
        elapsed_realtime_ms: u64,
        generation: u64,
        #[serde(rename = "screenState")]
        screen_state: NativeScreenState,
        #[serde(rename = "curtainVisible")]
        curtain_visible: bool,
    },
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NativeScreenState {
    Active,
    ScreenOff,
    DeviceLocked,
}

pub(crate) struct NativeSecuritySnapshot {
    pub(crate) foreground: bool,
    pub(crate) elapsed_realtime_ms: u64,
    pub(crate) generation: u64,
    pub(crate) screen_state: NativeScreenState,
    pub(crate) curtain_visible: bool,
}

#[derive(Serialize)]
struct SecurityAcknowledgementRequest {
    generation: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeSecurityAcknowledgement {
    Acknowledged,
    Stale,
}

impl AndroidVaultSource {
    pub(crate) async fn security_status(&self) -> Result<NativeSecuritySnapshot, MobileError> {
        let response = self
            .0
            .run_mobile_plugin_async::<NativeSecurityResponse>("securityStatus", ())
            .await
            .map_err(|_| MobileError::Internal)?;
        let NativeSecurityResponse::Ok {
            foreground,
            elapsed_realtime_ms,
            generation,
            screen_state,
            curtain_visible,
        } = response;
        Ok(NativeSecuritySnapshot {
            foreground,
            elapsed_realtime_ms,
            generation,
            screen_state,
            curtain_visible,
        })
    }

    pub(crate) async fn acknowledge_safe_ui(&self, generation: u64) -> Result<bool, MobileError> {
        let response = self
            .0
            .run_mobile_plugin_async::<NativeSecurityAcknowledgement>(
                "acknowledgeSafeUi",
                SecurityAcknowledgementRequest { generation },
            )
            .await
            .map_err(|_| MobileError::Internal)?;
        Ok(matches!(
            response,
            NativeSecurityAcknowledgement::Acknowledged
        ))
    }
}
