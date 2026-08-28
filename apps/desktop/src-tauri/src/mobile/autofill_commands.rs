#![cfg(target_os = "android")]

use tauri::State;

use crate::mobile::{
    MobileAppState, MobileError,
    autofill::{
        AndroidCredentialTarget, AutofillCandidateDto, AutofillRequestKindDto,
        MobileAutofillLaunchDto, MobileAutofillRequestDto, MobileAutofillStatusDto,
        NativeAutofillRequest,
    },
    commands::lock_service,
    errors::MobileErrorDto,
    source::AndroidVaultSource,
};

#[tauri::command]
pub(crate) async fn mobile_autofill_status(
    source: State<'_, AndroidVaultSource>,
) -> Result<MobileAutofillStatusDto, MobileErrorDto> {
    source.autofill_status().await.map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn mobile_enable_autofill_for_vault(
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<MobileAutofillStatusDto, MobileErrorDto> {
    let token = lock_service(&state)?
        .source_token()
        .map_err(MobileErrorDto::from)?;
    source
        .enable_autofill(&token)
        .await
        .map_err(MobileErrorDto::from)?;
    source.autofill_status().await.map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn mobile_disable_autofill_for_vault(
    source: State<'_, AndroidVaultSource>,
) -> Result<MobileAutofillStatusDto, MobileErrorDto> {
    source
        .disable_autofill()
        .await
        .map_err(MobileErrorDto::from)?;
    source.autofill_status().await.map_err(Into::into)
}

async fn current_request(
    source: &AndroidVaultSource,
) -> Result<
    Option<(
        String,
        AutofillRequestKindDto,
        AndroidCredentialTarget,
        bool,
        Option<String>,
    )>,
    MobileError,
> {
    source
        .describe_autofill_request()
        .await?
        .map(NativeAutofillRequest::into_parts)
        .transpose()
}

#[tauri::command]
pub(crate) async fn mobile_autofill_request(
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<Option<MobileAutofillLaunchDto>, MobileErrorDto> {
    let Some((request_token, kind, target, requires_confirmation, selected_entry_id)) =
        current_request(&source)
            .await
            .map_err(MobileErrorDto::from)?
    else {
        return Ok(None);
    };
    let needs_source = {
        let service = lock_service(&state)?;
        !service.is_unlocked() && !service.has_pending_selection()
    };
    if needs_source {
        let operation = lock_service(&state)?
            .begin_selection()
            .map_err(MobileErrorDto::from)?;
        let selected = match source.rehydrate_autofill_source().await {
            Ok(Some(selected)) => selected,
            Ok(None) => {
                lock_service(&state)?.finish_operation(operation.id);
                return Ok(Some(launch(
                    request_token,
                    kind,
                    &target,
                    requires_confirmation,
                    selected_entry_id,
                    lock_service(&state)?.pending_selection(),
                )));
            }
            Err(error) => {
                lock_service(&state)?.finish_operation(operation.id);
                return Err(error.into());
            }
        };
        let selected_token = selected.source_token.clone();
        let selected_recovery = selected.recovery_required;
        let completion = {
            lock_service(&state)?.complete_selection(
                operation.id,
                selected.staged_path,
                selected.file_name,
                selected.source_token,
                selected.writable,
                selected.recovery_required,
            )
        };
        if let Err(error) = completion {
            let _ = source.release(&selected_token, selected_recovery).await;
            return Err(error.into());
        }
    }
    Ok(Some(launch(
        request_token,
        kind,
        &target,
        requires_confirmation,
        selected_entry_id,
        lock_service(&state)?.pending_selection(),
    )))
}

fn launch(
    request_token: String,
    kind: AutofillRequestKindDto,
    target: &AndroidCredentialTarget,
    requires_confirmation: bool,
    selected_entry_id: Option<String>,
    selected_vault: Option<crate::dto::MobileSelectedVaultDto>,
) -> MobileAutofillLaunchDto {
    MobileAutofillLaunchDto {
        request: MobileAutofillRequestDto {
            request_token,
            kind,
            target_display: target.display(),
            requires_confirmation,
            selected_entry_id,
        },
        selected_vault,
    }
}

async fn validated_target(
    source: &AndroidVaultSource,
    request_token: &str,
) -> Result<AndroidCredentialTarget, MobileErrorDto> {
    let Some((active_token, _, target, _, _)) = current_request(source)
        .await
        .map_err(MobileErrorDto::from)?
    else {
        return Err(MobileError::AutofillUnavailable.into());
    };
    if active_token != request_token {
        return Err(MobileError::AutofillUnavailable.into());
    }
    Ok(target)
}

#[tauri::command]
pub(crate) async fn mobile_autofill_candidates(
    request_token: String,
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<Vec<AutofillCandidateDto>, MobileErrorDto> {
    let target = validated_target(&source, &request_token).await?;
    lock_service(&state)?
        .autofill_candidates(&target)
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn mobile_autofill_publish_candidates(
    request_token: String,
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<(), MobileErrorDto> {
    let target = validated_target(&source, &request_token).await?;
    let candidates = lock_service(&state)?
        .autofill_candidates(&target)
        .map_err(MobileErrorDto::from)?;
    source
        .publish_autofill_candidates(&request_token, &candidates)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn mobile_autofill_approve(
    request_token: String,
    entry_id: String,
    approved: bool,
    source: State<'_, AndroidVaultSource>,
    state: State<'_, MobileAppState>,
) -> Result<(), MobileErrorDto> {
    let Some((active_token, _, target, requires_confirmation, selected_entry_id)) =
        current_request(&source)
            .await
            .map_err(MobileErrorDto::from)?
    else {
        return Err(MobileError::AutofillUnavailable.into());
    };
    if active_token != request_token
        || selected_entry_id
            .as_ref()
            .is_some_and(|selected| selected != &entry_id)
        || (requires_confirmation && !approved)
    {
        return Err(MobileError::CredentialUnavailable.into());
    }
    let prepared = lock_service(&state)?
        .begin_autofill_fulfillment(request_token, &entry_id, &target)
        .map_err(MobileErrorDto::from)?;
    let result = source
        .fulfill_autofill(
            &prepared.request_token,
            &prepared.entry_id,
            prepared.username.expose_secret(),
            prepared.password.expose_secret(),
            approved,
        )
        .await;
    let mut service = lock_service(&state)?;
    match result {
        Ok(()) => service
            .complete_autofill_fulfillment(prepared.operation)
            .map_err(Into::into),
        Err(error) => {
            service.cancel_operation(prepared.operation);
            Err(error.into())
        }
    }
}

#[tauri::command]
pub(crate) async fn mobile_autofill_cancel(
    request_token: String,
    source: State<'_, AndroidVaultSource>,
) -> Result<(), MobileErrorDto> {
    source
        .cancel_autofill(&request_token)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub(crate) async fn mobile_open_autofill_settings(
    source: State<'_, AndroidVaultSource>,
) -> Result<(), MobileErrorDto> {
    source.open_autofill_settings().await.map_err(Into::into)
}
