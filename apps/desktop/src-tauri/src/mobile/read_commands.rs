#![cfg(target_os = "android")]

use tauri::State;

use crate::dto::{
    EntryAttachmentSummaryDto, EntryDetailDto, EntryHistoryDto, MobileVaultSnapshotDto, TotpCodeDto,
};

use super::{
    MobileAppState,
    commands::lock_service,
    errors::MobileErrorDto,
    state::{MobileSecretKind, MobileVaultService},
};

macro_rules! read_command {
    ($name:ident, $result:ty, $call:expr) => {
        #[tauri::command]
        pub(crate) fn $name(state: State<'_, MobileAppState>) -> Result<$result, MobileErrorDto> {
            $call(&*lock_service(&state)?).map_err(Into::into)
        }
    };
}

read_command!(
    mobile_vault_snapshot,
    MobileVaultSnapshotDto,
    MobileVaultService::snapshot
);

#[tauri::command]
pub(crate) fn mobile_entry_detail(
    entry_id: String,
    state: State<'_, MobileAppState>,
) -> Result<EntryDetailDto, MobileErrorDto> {
    lock_service(&state)?
        .entry_detail(&entry_id)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn mobile_entry_history(
    entry_id: String,
    state: State<'_, MobileAppState>,
) -> Result<EntryHistoryDto, MobileErrorDto> {
    lock_service(&state)?
        .entry_history(&entry_id)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn mobile_entry_attachments(
    entry_id: String,
    state: State<'_, MobileAppState>,
) -> Result<Vec<EntryAttachmentSummaryDto>, MobileErrorDto> {
    lock_service(&state)?
        .entry_attachments(&entry_id)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) fn mobile_entry_totp_code(
    entry_id: String,
    state: State<'_, MobileAppState>,
) -> Result<TotpCodeDto, MobileErrorDto> {
    let value = lock_service(&state)?
        .entry_totp_code(&entry_id)
        .map_err(MobileErrorDto::from)?;
    Ok(TotpCodeDto {
        code: value.code().expose_secret().to_owned(),
        valid_for_seconds: value.valid_for_seconds(),
        period_seconds: value.period_seconds(),
    })
}

macro_rules! load_secret_command {
    ($name:ident, $kind:ident) => {
        #[tauri::command]
        pub(crate) fn $name(
            entry_id: String,
            state: State<'_, MobileAppState>,
        ) -> Result<String, MobileErrorDto> {
            lock_service(&state)?
                .entry_secret(&entry_id, MobileSecretKind::$kind)
                .map(|secret| secret.expose_secret().to_owned())
                .map_err(Into::into)
        }
    };
}

load_secret_command!(mobile_load_entry_title, Title);
load_secret_command!(mobile_load_entry_username, Username);
load_secret_command!(mobile_load_entry_url, Url);
load_secret_command!(mobile_load_entry_notes, Notes);
#[tauri::command]
pub(crate) fn mobile_load_entry_custom_field(
    entry_id: String,
    name: String,
    state: State<'_, MobileAppState>,
) -> Result<String, MobileErrorDto> {
    lock_service(&state)?
        .entry_custom_field(&entry_id, &name)
        .map(|secret| secret.expose_secret().to_owned())
        .map_err(Into::into)
}
