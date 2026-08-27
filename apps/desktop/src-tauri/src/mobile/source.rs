#![cfg(target_os = "android")]

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{
    Manager,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

use super::{
    MobileError,
    transaction::{MobileDocumentSource, NativeCommitOutcome, NativeSavePaths},
};

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
        #[serde(rename = "sourceToken")]
        source_token: String,
        writable: bool,
        #[serde(rename = "recoveryRequired")]
        recovery_required: bool,
    },
}

pub(crate) struct StagedMobileSelection {
    pub(crate) staged_path: PathBuf,
    pub(crate) file_name: String,
    pub(crate) source_token: String,
    pub(crate) writable: bool,
    pub(crate) recovery_required: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceRequest<'a> {
    source_token: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeStageResponse {
    Ready {
        #[serde(rename = "transactionToken")]
        transaction_token: String,
        #[serde(rename = "currentPath")]
        current_path: PathBuf,
        #[serde(rename = "candidatePath")]
        candidate_path: PathBuf,
    },
    PersistenceUnsupported,
    RecoveryRequired,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitRequest<'a> {
    source_token: &'a str,
    transaction_token: &'a str,
    baseline: &'a str,
    candidate: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeCommitResponse {
    Verified {
        #[serde(rename = "readBackPath")]
        read_back_path: PathBuf,
    },
    ExternalChange,
    SaveFailed,
    SaveUncertain,
    RecoveryRequired,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransactionRequest<'a> {
    source_token: &'a str,
    transaction_token: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseRequest<'a> {
    source_token: &'a str,
    preserve_recovery: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeVoidResponse {
    Ok,
    Failed,
    SaveUncertain,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeReadResponse {
    Ready {
        #[serde(rename = "readToken")]
        read_token: String,
        #[serde(rename = "stagedPath")]
        staged_path: PathBuf,
    },
    RecoveryRequired,
    Failed,
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
                source_token,
                writable,
                recovery_required,
            } => Some(StagedMobileSelection {
                staged_path,
                file_name,
                source_token,
                writable,
                recovery_required,
            }),
        })
    }

    pub(crate) async fn stage_current(
        &self,
        source_token: &str,
    ) -> Result<(String, PathBuf), MobileError> {
        match self
            .0
            .run_mobile_plugin_async::<NativeReadResponse>(
                "stageCurrent",
                SourceRequest { source_token },
            )
            .await
            .map_err(|_| MobileError::ReloadFailed)?
        {
            NativeReadResponse::Ready {
                read_token,
                staged_path,
            } => Ok((read_token, staged_path)),
            NativeReadResponse::RecoveryRequired => Err(MobileError::RecoveryRequired),
            NativeReadResponse::Failed => Err(MobileError::ReloadFailed),
        }
    }

    pub(crate) async fn finish_read(&self, source_token: &str, read_token: &str) {
        let _ = self
            .0
            .run_mobile_plugin_async::<NativeVoidResponse>(
                "finishRead",
                TransactionRequest {
                    source_token,
                    transaction_token: read_token,
                },
            )
            .await;
    }

    pub(crate) async fn release(
        &self,
        source_token: &str,
        preserve_recovery: bool,
    ) -> Result<(), MobileError> {
        match self
            .0
            .run_mobile_plugin_async::<NativeVoidResponse>(
                "releaseSource",
                ReleaseRequest {
                    source_token,
                    preserve_recovery,
                },
            )
            .await
            .map_err(|_| MobileError::Internal)?
        {
            NativeVoidResponse::Ok => Ok(()),
            NativeVoidResponse::Failed | NativeVoidResponse::SaveUncertain => {
                Err(MobileError::Internal)
            }
        }
    }
}

impl MobileDocumentSource for AndroidVaultSource {
    async fn prepare_save(&self, source_token: &str) -> Result<NativeSavePaths, MobileError> {
        let response = self
            .0
            .run_mobile_plugin_async::<NativeStageResponse>(
                "prepareSave",
                SourceRequest { source_token },
            )
            .await
            .map_err(|_| MobileError::SaveFailed)?;
        match response {
            NativeStageResponse::Ready {
                transaction_token,
                current_path,
                candidate_path,
            } => Ok(NativeSavePaths {
                transaction_token,
                current_path,
                candidate_path,
            }),
            NativeStageResponse::PersistenceUnsupported => Err(MobileError::PersistenceUnsupported),
            NativeStageResponse::RecoveryRequired => Err(MobileError::RecoveryRequired),
            NativeStageResponse::Failed => Err(MobileError::SaveFailed),
        }
    }

    async fn commit_candidate(
        &self,
        source_token: &str,
        transaction_token: &str,
        baseline: &str,
        candidate: &str,
    ) -> Result<NativeCommitOutcome, MobileError> {
        let response = self
            .0
            .run_mobile_plugin_async::<NativeCommitResponse>(
                "commitCandidate",
                CommitRequest {
                    source_token,
                    transaction_token,
                    baseline,
                    candidate,
                },
            )
            .await
            .map_err(|_| MobileError::SaveUncertain)?;
        Ok(match response {
            NativeCommitResponse::Verified { read_back_path } => {
                NativeCommitOutcome::Verified(read_back_path)
            }
            NativeCommitResponse::ExternalChange => {
                NativeCommitOutcome::Failed(MobileError::ExternalChange)
            }
            NativeCommitResponse::SaveFailed => {
                NativeCommitOutcome::Failed(MobileError::SaveFailed)
            }
            NativeCommitResponse::SaveUncertain => {
                NativeCommitOutcome::Failed(MobileError::SaveUncertain)
            }
            NativeCommitResponse::RecoveryRequired => {
                NativeCommitOutcome::Failed(MobileError::RecoveryRequired)
            }
        })
    }

    async fn finalize_save(
        &self,
        source_token: &str,
        transaction_token: &str,
    ) -> Result<(), MobileError> {
        match self
            .0
            .run_mobile_plugin_async::<NativeVoidResponse>(
                "finalizeSave",
                TransactionRequest {
                    source_token,
                    transaction_token,
                },
            )
            .await
            .map_err(|_| MobileError::SaveUncertain)?
        {
            NativeVoidResponse::Ok => Ok(()),
            NativeVoidResponse::Failed | NativeVoidResponse::SaveUncertain => {
                Err(MobileError::SaveUncertain)
            }
        }
    }

    async fn abort_save(&self, source_token: &str, transaction_token: &str) {
        let _ = self
            .0
            .run_mobile_plugin_async::<NativeVoidResponse>(
                "abortSave",
                TransactionRequest {
                    source_token,
                    transaction_token,
                },
            )
            .await;
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
