#![cfg(target_os = "android")]

use serde::Serialize;
use tauri::State;

use super::{
    MobileAppState, commands::lock_service, errors::MobileErrorDto, source::AndroidVaultSource,
    source_security::NativeScreenState,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MobileSecurityResumeDto {
    foreground: bool,
    elapsed_realtime_ms: u64,
    generation: u64,
    screen_state: NativeScreenState,
    curtain_visible: bool,
    vault_state: &'static str,
    operation_pending: bool,
}

#[derive(Serialize)]
pub(crate) struct MobileSecurityAcknowledgementDto {
    acknowledged: bool,
}

#[tauri::command]
pub(crate) async fn mobile_security_resume(
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<MobileSecurityResumeDto, MobileErrorDto> {
    let native = source
        .security_status()
        .await
        .map_err(MobileErrorDto::from)?;
    let service = lock_service(&state)?;
    Ok(MobileSecurityResumeDto {
        foreground: native.foreground,
        elapsed_realtime_ms: native.elapsed_realtime_ms,
        generation: native.generation,
        screen_state: native.screen_state,
        curtain_visible: native.curtain_visible,
        vault_state: service.security_vault_state(),
        operation_pending: service.has_active_operation(),
    })
}

#[tauri::command]
pub(crate) async fn mobile_security_acknowledge_safe_ui(
    generation: u64,
    source: State<'_, AndroidVaultSource>,
) -> Result<MobileSecurityAcknowledgementDto, MobileErrorDto> {
    Ok(MobileSecurityAcknowledgementDto {
        acknowledged: source
            .acknowledge_safe_ui(generation)
            .await
            .map_err(MobileErrorDto::from)?,
    })
}
