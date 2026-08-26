#![cfg(target_os = "android")]

use std::path::PathBuf;

use serde::Deserialize;
use tauri::{
    Manager,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

use super::MobileError;

const PLUGIN_IDENTIFIER: &str = "dev.nian.pass";

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeSelectionResponse {
    Cancelled,
    Selected {
        #[serde(rename = "stagedPath")]
        staged_path: PathBuf,
        #[serde(rename = "fileName")]
        file_name: String,
    },
}

pub(crate) struct StagedMobileSelection {
    pub(crate) staged_path: PathBuf,
    pub(crate) file_name: String,
}

#[derive(Clone)]
pub(crate) struct AndroidVaultSource(PluginHandle<tauri::Wry>);

impl AndroidVaultSource {
    pub(crate) async fn select(&self) -> Result<Option<StagedMobileSelection>, MobileError> {
        let response = self
            .0
            .run_mobile_plugin_async::<NativeSelectionResponse>("selectVault", ())
            .await
            .map_err(|_| MobileError::PickerFailed)?;
        Ok(match response {
            NativeSelectionResponse::Cancelled => None,
            NativeSelectionResponse::Selected {
                staged_path,
                file_name,
            } => Some(StagedMobileSelection {
                staged_path,
                file_name,
            }),
        })
    }
}

pub(crate) fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("vault-source")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "VaultSourcePlugin")?;
            app.manage(AndroidVaultSource(handle));
            Ok(())
        })
        .build()
}
