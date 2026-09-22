#![cfg(target_os = "android")]

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::{
    MobileError,
    source::{AndroidVaultSource, NativeVoidResponse},
};

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeAttachmentImportResponse {
    Cancelled,
    Selected {
        #[serde(rename = "importToken")]
        import_token: String,
        #[serde(rename = "stagedPath")]
        staged_path: PathBuf,
        #[serde(rename = "fileName")]
        file_name: String,
    },
    Failed,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeAttachmentExportStageResponse {
    Ready {
        #[serde(rename = "exportToken")]
        export_token: String,
        #[serde(rename = "candidatePath")]
        candidate_path: PathBuf,
    },
    Failed,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeAttachmentExportResponse {
    Ok,
    Cancelled,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentTokenRequest<'a> {
    token: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentExportRequest<'a> {
    token: &'a str,
    suggested_name: &'a str,
}

impl AndroidVaultSource {
    pub(crate) async fn select_attachment_import(
        &self,
    ) -> Result<Option<(String, PathBuf, String)>, MobileError> {
        let response = self
            .0
            .run_mobile_plugin_async::<NativeAttachmentImportResponse>("selectAttachmentImport", ())
            .await
            .map_err(|_| MobileError::PickerFailed)?;
        match response {
            NativeAttachmentImportResponse::Cancelled => Ok(None),
            NativeAttachmentImportResponse::Selected {
                import_token,
                staged_path,
                file_name,
            } => Ok(Some((import_token, staged_path, file_name))),
            NativeAttachmentImportResponse::Failed => Err(MobileError::PickerFailed),
        }
    }

    pub(crate) async fn finish_attachment_import(&self, token: &str) {
        let _ = self
            .0
            .run_mobile_plugin_async::<NativeVoidResponse>(
                "finishAttachmentImport",
                AttachmentTokenRequest { token },
            )
            .await;
    }

    pub(crate) async fn prepare_attachment_export(&self) -> Result<(String, PathBuf), MobileError> {
        match self
            .0
            .run_mobile_plugin_async::<NativeAttachmentExportStageResponse>(
                "prepareAttachmentExport",
                (),
            )
            .await
            .map_err(|_| MobileError::Internal)?
        {
            NativeAttachmentExportStageResponse::Ready {
                export_token,
                candidate_path,
            } => Ok((export_token, candidate_path)),
            NativeAttachmentExportStageResponse::Failed => Err(MobileError::Internal),
        }
    }

    pub(crate) async fn export_attachment(
        &self,
        token: &str,
        suggested_name: &str,
    ) -> Result<bool, MobileError> {
        match self
            .0
            .run_mobile_plugin_async::<NativeAttachmentExportResponse>(
                "exportAttachment",
                AttachmentExportRequest {
                    token,
                    suggested_name,
                },
            )
            .await
            .map_err(|_| MobileError::PickerFailed)?
        {
            NativeAttachmentExportResponse::Ok => Ok(true),
            NativeAttachmentExportResponse::Cancelled => Ok(false),
            NativeAttachmentExportResponse::Failed => Err(MobileError::Internal),
        }
    }

    pub(crate) async fn abort_attachment_export(&self, token: &str) {
        let _ = self
            .0
            .run_mobile_plugin_async::<NativeVoidResponse>(
                "abortAttachmentExport",
                AttachmentTokenRequest { token },
            )
            .await;
    }
}
