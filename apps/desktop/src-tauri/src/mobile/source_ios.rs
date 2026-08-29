#![cfg(target_os = "ios")]

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{
    Manager,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

use super::{MobileError, autofill::MobileAutofillStatusDto};

tauri::ios_plugin_binding!(init_plugin_ios_vault_source);

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeSelectionResponse {
    Cancelled,
    Selected {
        #[serde(rename = "stagedPath")]
        staged_path: PathBuf,
        #[serde(rename = "fileName")]
        file_name: String,
        #[serde(rename = "sourceToken")]
        source_token: String,
    },
    Failed,
}

pub(crate) struct StagedIosSelection {
    pub(crate) staged_path: PathBuf,
    pub(crate) file_name: String,
    pub(crate) source_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceRequest<'a> {
    source_token: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IdentityProjection<'a> {
    pub(crate) record_identifier: &'a str,
    pub(crate) service_identifier: &'a str,
    pub(crate) username: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutofillRequest<'a> {
    source_token: &'a str,
    identities: &'a [IdentityProjection<'a>],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeAutofillStatus {
    supported: bool,
    source_enabled: bool,
    provider_selected: bool,
}

impl From<NativeAutofillStatus> for MobileAutofillStatusDto {
    fn from(value: NativeAutofillStatus) -> Self {
        Self {
            supported: value.supported,
            source_enabled: value.source_enabled,
            provider_selected: value.provider_selected,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeVoidResponse {
    Ok,
    Failed,
}

#[derive(Clone)]
pub(crate) struct IosVaultSource(PluginHandle<tauri::Wry>);

impl IosVaultSource {
    pub(crate) async fn select(&self) -> Result<Option<StagedIosSelection>, MobileError> {
        match self
            .0
            .run_mobile_plugin_async::<NativeSelectionResponse>("selectVault", ())
            .await
            .map_err(|_| MobileError::PickerFailed)?
        {
            NativeSelectionResponse::Cancelled => Ok(None),
            NativeSelectionResponse::Selected {
                staged_path,
                file_name,
                source_token,
            } => Ok(Some(StagedIosSelection {
                staged_path,
                file_name,
                source_token,
            })),
            NativeSelectionResponse::Failed => Err(MobileError::PickerFailed),
        }
    }

    pub(crate) async fn release(&self, source_token: &str) -> Result<(), MobileError> {
        match self
            .0
            .run_mobile_plugin_async::<NativeVoidResponse>(
                "releaseSource",
                SourceRequest { source_token },
            )
            .await
            .map_err(|_| MobileError::Internal)?
        {
            NativeVoidResponse::Ok => Ok(()),
            NativeVoidResponse::Failed => Err(MobileError::Internal),
        }
    }

    pub(crate) async fn autofill_status(&self) -> Result<MobileAutofillStatusDto, MobileError> {
        self.0
            .run_mobile_plugin_async::<NativeAutofillStatus>("autofillStatus", ())
            .await
            .map(Into::into)
            .map_err(|_| MobileError::AutofillUnavailable)
    }

    pub(crate) async fn configure_autofill(
        &self,
        command: &str,
        source_token: &str,
        identities: &[IdentityProjection<'_>],
    ) -> Result<MobileAutofillStatusDto, MobileError> {
        self.0
            .run_mobile_plugin_async::<NativeAutofillStatus>(
                command,
                AutofillRequest {
                    source_token,
                    identities,
                },
            )
            .await
            .map(Into::into)
            .map_err(|_| MobileError::AutofillUnavailable)
    }

    pub(crate) async fn disable_autofill(&self) -> Result<MobileAutofillStatusDto, MobileError> {
        self.0
            .run_mobile_plugin_async::<NativeAutofillStatus>("disableAutofill", ())
            .await
            .map(Into::into)
            .map_err(|_| MobileError::AutofillUnavailable)
    }

    pub(crate) async fn open_settings(&self) -> Result<(), MobileError> {
        match self
            .0
            .run_mobile_plugin_async::<NativeVoidResponse>("openCredentialProviderSettings", ())
            .await
            .map_err(|_| MobileError::AutofillUnavailable)?
        {
            NativeVoidResponse::Ok => Ok(()),
            NativeVoidResponse::Failed => Err(MobileError::AutofillUnavailable),
        }
    }
}

pub(crate) fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("ios-vault-source")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_ios_vault_source)?;
            app.manage(IosVaultSource(handle));
            Ok(())
        })
        .build()
}
