#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use credential_provider_core::{CredentialTarget, ProviderError};
use serde::{Deserialize, Serialize};
use vault_core::SecretString;

use crate::dto::SummaryTextDto;

use super::{MobileError, session::MobileVaultSession};

/// Android target data validated by the native request boundary. Signing
/// identities deliberately have no WebView-facing serialization path.
#[derive(Clone, Eq, PartialEq)]
pub(crate) enum AndroidCredentialTarget {
    App {
        package_name: String,
        signing_identity: String,
    },
    Web {
        package_name: String,
        web_domain: String,
        browser_signing_identity: String,
    },
}

impl AndroidCredentialTarget {
    #[cfg(test)]
    pub(crate) fn package_name(&self) -> &str {
        match self {
            Self::App { package_name, .. } | Self::Web { package_name, .. } => package_name,
        }
    }

    #[cfg(test)]
    pub(crate) fn signing_identity(&self) -> &str {
        match self {
            Self::App {
                signing_identity, ..
            } => signing_identity,
            Self::Web {
                browser_signing_identity,
                ..
            } => browser_signing_identity,
        }
    }

    pub(crate) fn display(&self) -> String {
        match self {
            Self::App { package_name, .. } => package_name.clone(),
            Self::Web { web_domain, .. } => web_domain.clone(),
        }
    }

    fn provider_target(&self) -> Result<CredentialTarget, MobileError> {
        match self {
            Self::App { package_name, .. } => CredentialTarget::android_app(package_name.clone()),
            Self::Web { web_domain, .. } => CredentialTarget::web_domain(web_domain),
        }
        .map_err(map_provider_error)
    }
}

#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutofillCandidateDto {
    pub(crate) entry_id: String,
    pub(crate) title: SummaryTextDto,
    pub(crate) username: SummaryTextDto,
}

#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutofillRequestKindDto {
    CredentialQuery,
    CredentialFulfillment,
    Autofill,
}

#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MobileAutofillRequestDto {
    pub(crate) request_token: String,
    pub(crate) kind: AutofillRequestKindDto,
    pub(crate) target_display: String,
    pub(crate) requires_confirmation: bool,
    pub(crate) selected_entry_id: Option<String>,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MobileAutofillStatusDto {
    pub(crate) supported: bool,
    pub(crate) source_enabled: bool,
    pub(crate) provider_selected: bool,
}

#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MobileAutofillLaunchDto {
    pub(crate) request: MobileAutofillRequestDto,
    pub(crate) selected_vault: Option<crate::dto::MobileSelectedVaultDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NativeAutofillRequest {
    pub(crate) request_token: String,
    pub(crate) kind: NativeRequestKind,
    pub(crate) target_kind: NativeTargetKind,
    pub(crate) package_name: String,
    pub(crate) signing_identity: String,
    pub(crate) web_domain: Option<String>,
    pub(crate) trusted: bool,
    pub(crate) selected_entry_id: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NativeRequestKind {
    CredentialQuery,
    CredentialFulfillment,
    Autofill,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NativeTargetKind {
    App,
    Web,
}

impl NativeAutofillRequest {
    pub(crate) fn into_parts(
        self,
    ) -> Result<
        (
            String,
            AutofillRequestKindDto,
            AndroidCredentialTarget,
            bool,
            Option<String>,
        ),
        MobileError,
    > {
        if self.request_token.is_empty()
            || self.package_name.is_empty()
            || self.signing_identity.is_empty()
        {
            return Err(MobileError::InvalidRequest);
        }
        let target = match self.target_kind {
            NativeTargetKind::App if self.web_domain.is_none() => AndroidCredentialTarget::App {
                package_name: self.package_name,
                signing_identity: self.signing_identity,
            },
            NativeTargetKind::Web => AndroidCredentialTarget::Web {
                package_name: self.package_name,
                web_domain: CredentialTarget::web_domain(
                    self.web_domain
                        .as_deref()
                        .ok_or(MobileError::InvalidRequest)?,
                )
                .map_err(|_| MobileError::InvalidRequest)?
                .display()
                .to_owned(),
                browser_signing_identity: self.signing_identity,
            },
            NativeTargetKind::App => return Err(MobileError::InvalidRequest),
        };
        let kind = match self.kind {
            NativeRequestKind::CredentialQuery => AutofillRequestKindDto::CredentialQuery,
            NativeRequestKind::CredentialFulfillment => {
                AutofillRequestKindDto::CredentialFulfillment
            }
            NativeRequestKind::Autofill => AutofillRequestKindDto::Autofill,
        };
        Ok((
            self.request_token,
            kind,
            target,
            !self.trusted,
            self.selected_entry_id,
        ))
    }
}

pub(crate) struct PreparedAutofillFulfillment {
    pub(crate) operation: u64,
    pub(crate) request_token: String,
    pub(crate) entry_id: String,
    pub(crate) username: SecretString,
    pub(crate) password: SecretString,
}

impl MobileVaultSession {
    pub(crate) fn autofill_candidates(
        &self,
        target: &AndroidCredentialTarget,
    ) -> Result<Vec<AutofillCandidateDto>, MobileError> {
        credential_provider_core::candidates(&self.document, &target.provider_target()?)
            .map_err(map_provider_error)?
            .into_iter()
            .map(|candidate| {
                Ok(AutofillCandidateDto {
                    entry_id: candidate.entry_id().to_owned(),
                    title: candidate.title().into(),
                    username: candidate.username().into(),
                })
            })
            .collect()
    }

    pub(crate) fn prepare_autofill_secret(
        &self,
        operation: u64,
        request_token: String,
        entry_id: &str,
        target: &AndroidCredentialTarget,
    ) -> Result<PreparedAutofillFulfillment, MobileError> {
        let credential = credential_provider_core::credential(
            &self.document,
            entry_id,
            &target.provider_target()?,
        )
        .map_err(map_provider_error)?;
        let (username, password) = credential.into_secrets();
        Ok(PreparedAutofillFulfillment {
            operation,
            request_token,
            entry_id: entry_id.to_owned(),
            username,
            password,
        })
    }
}

fn map_provider_error(error: ProviderError) -> MobileError {
    match error {
        ProviderError::InvalidTarget => MobileError::InvalidRequest,
        ProviderError::CredentialUnavailable => MobileError::CredentialUnavailable,
        ProviderError::Internal => MobileError::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AndroidCredentialTarget, AutofillRequestKindDto, NativeAutofillRequest, NativeRequestKind,
        NativeTargetKind,
    };
    use crate::mobile::MobileError;

    fn native_request(
        kind: NativeRequestKind,
        target_kind: NativeTargetKind,
        web_domain: Option<&str>,
        trusted: bool,
    ) -> NativeAutofillRequest {
        NativeAutofillRequest {
            request_token: "opaque-request".to_owned(),
            kind,
            target_kind,
            package_name: "dev.example.browser".to_owned(),
            signing_identity: "certificate".to_owned(),
            web_domain: web_domain.map(str::to_owned),
            trusted,
            selected_entry_id: Some("entry".to_owned()),
        }
    }

    #[test]
    fn native_app_and_web_targets_keep_signing_identity_internal() {
        let (token, kind, app, requires_confirmation, entry) = native_request(
            NativeRequestKind::CredentialQuery,
            NativeTargetKind::App,
            None,
            false,
        )
        .into_parts()
        .expect("app target");
        assert_eq!(token, "opaque-request");
        assert!(matches!(kind, AutofillRequestKindDto::CredentialQuery));
        assert_eq!(app.package_name(), "dev.example.browser");
        assert_eq!(app.signing_identity(), "certificate");
        assert_eq!(app.display(), "dev.example.browser");
        assert!(requires_confirmation);
        assert_eq!(entry.as_deref(), Some("entry"));

        let (_, kind, web, requires_confirmation, _) = native_request(
            NativeRequestKind::CredentialFulfillment,
            NativeTargetKind::Web,
            Some("EXAMPLE.com."),
            true,
        )
        .into_parts()
        .expect("web target");
        assert!(matches!(
            kind,
            AutofillRequestKindDto::CredentialFulfillment
        ));
        assert_eq!(web.package_name(), "dev.example.browser");
        assert_eq!(web.signing_identity(), "certificate");
        assert_eq!(web.display(), "example.com");
        assert!(!requires_confirmation);
        assert!(matches!(web, AndroidCredentialTarget::Web { .. }));

        let (_, kind, _, _, _) = native_request(
            NativeRequestKind::Autofill,
            NativeTargetKind::App,
            None,
            true,
        )
        .into_parts()
        .expect("autofill target");
        assert!(matches!(kind, AutofillRequestKindDto::Autofill));
    }

    #[test]
    fn malformed_native_targets_fail_closed() {
        let mut missing_token = native_request(
            NativeRequestKind::Autofill,
            NativeTargetKind::App,
            None,
            false,
        );
        missing_token.request_token.clear();
        assert!(matches!(
            missing_token.into_parts(),
            Err(MobileError::InvalidRequest)
        ));
        assert!(matches!(
            native_request(
                NativeRequestKind::Autofill,
                NativeTargetKind::App,
                Some("example.com"),
                false,
            )
            .into_parts(),
            Err(MobileError::InvalidRequest)
        ));
        assert!(matches!(
            native_request(
                NativeRequestKind::Autofill,
                NativeTargetKind::Web,
                None,
                false
            )
            .into_parts(),
            Err(MobileError::InvalidRequest)
        ));
    }
}
