#![cfg(target_os = "android")]

use super::{
    MobileError,
    autofill::{
        AutofillCandidateDto, MobileAutofillStatusDto, NativeAutofillRequest, NativeRequestKind,
        NativeTargetKind,
    },
    source::{AndroidVaultSource, NativeSelectionResponse, SourceRequest, StagedMobileSelection},
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
enum NativeAutofillRequestResponse {
    Unavailable,
    Available {
        #[serde(rename = "requestToken")]
        request_token: String,
        kind: NativeRequestKind,
        #[serde(rename = "targetKind")]
        target_kind: NativeTargetKind,
        #[serde(rename = "packageName")]
        package_name: String,
        #[serde(rename = "signingIdentity")]
        signing_identity: String,
        #[serde(rename = "webDomain")]
        web_domain: Option<String>,
        trusted: bool,
        #[serde(rename = "selectedEntryId")]
        selected_entry_id: Option<String>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestTokenRequest<'a> {
    request_token: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidateRequest<'a> {
    request_token: &'a str,
    candidates: &'a [AutofillCandidateDto],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FulfillmentRequest<'a> {
    request_token: &'a str,
    entry_id: &'a str,
    username: &'a str,
    password: &'a str,
    approved: bool,
}

impl AndroidVaultSource {
    pub(crate) async fn autofill_status(&self) -> Result<MobileAutofillStatusDto, MobileError> {
        self.0
            .run_mobile_plugin_async::<MobileAutofillStatusDto>("autofillStatus", ())
            .await
            .map_err(|_| MobileError::AutofillUnavailable)
    }

    pub(crate) async fn enable_autofill(&self, source_token: &str) -> Result<(), MobileError> {
        self.void_command("enableAutofill", SourceRequest { source_token })
            .await
    }

    pub(crate) async fn disable_autofill(&self) -> Result<(), MobileError> {
        self.void_command("disableAutofill", ()).await
    }

    pub(crate) async fn rehydrate_autofill_source(
        &self,
    ) -> Result<Option<StagedMobileSelection>, MobileError> {
        let response = self
            .0
            .run_mobile_plugin_async::<NativeSelectionResponse>("rehydrateAutofillSource", ())
            .await
            .map_err(|_| MobileError::AutofillUnavailable)?;
        Ok(match response {
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
            NativeSelectionResponse::Cancelled | NativeSelectionResponse::Unavailable => None,
        })
    }

    pub(crate) async fn describe_autofill_request(
        &self,
    ) -> Result<Option<NativeAutofillRequest>, MobileError> {
        let response = self
            .0
            .run_mobile_plugin_async::<NativeAutofillRequestResponse>("describeAutofillRequest", ())
            .await
            .map_err(|_| MobileError::AutofillUnavailable)?;
        Ok(match response {
            NativeAutofillRequestResponse::Unavailable => None,
            NativeAutofillRequestResponse::Available {
                request_token,
                kind,
                target_kind,
                package_name,
                signing_identity,
                web_domain,
                trusted,
                selected_entry_id,
            } => Some(NativeAutofillRequest {
                request_token,
                kind,
                target_kind,
                package_name,
                signing_identity,
                web_domain,
                trusted,
                selected_entry_id,
            }),
        })
    }

    pub(crate) async fn publish_autofill_candidates(
        &self,
        request_token: &str,
        candidates: &[AutofillCandidateDto],
    ) -> Result<(), MobileError> {
        self.void_command(
            "publishAutofillCandidates",
            CandidateRequest {
                request_token,
                candidates,
            },
        )
        .await
    }

    pub(crate) async fn fulfill_autofill(
        &self,
        request_token: &str,
        entry_id: &str,
        username: &str,
        password: &str,
        approved: bool,
    ) -> Result<(), MobileError> {
        self.void_command(
            "fulfillAutofill",
            FulfillmentRequest {
                request_token,
                entry_id,
                username,
                password,
                approved,
            },
        )
        .await
    }

    pub(crate) async fn cancel_autofill(&self, request_token: &str) -> Result<(), MobileError> {
        self.void_command("cancelAutofill", RequestTokenRequest { request_token })
            .await
    }

    pub(crate) async fn open_autofill_settings(&self) -> Result<(), MobileError> {
        self.void_command("openAutofillSettings", ()).await
    }
}
