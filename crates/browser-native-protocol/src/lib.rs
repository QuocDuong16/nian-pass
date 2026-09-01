//! Strict, bounded browser-native and desktop-local IPC contract.
//!
//! This crate is transport-only. It has no KDBX, vault-session, Tauri, or
//! credential-matching authority.

mod framing;
mod ipc;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub use framing::{FrameError, read_frame, read_request, read_response, write_message};
pub use ipc::{
    DesktopListener, DesktopStream, bind_desktop_listener, connect_desktop,
    desktop_endpoint_description,
};
#[cfg(unix)]
pub use ipc::{bind_desktop_listener_in, connect_desktop_in};

pub const PROTOCOL_VERSION: u16 = 1;
pub const HOST_NAME: &str = "io.nianpass.browser";
pub const CHROMIUM_DEVELOPMENT_EXTENSION_ID: &str = "hikglhjadglkpicocjdjipeifnemoplg";
pub const FIREFOX_DEVELOPMENT_EXTENSION_ID: &str = "browser@nian-pass.local";
pub const MAX_FRAME_BYTES: usize = 256 * 1024;
pub const MAX_CANDIDATES: usize = 100;
pub const MAX_CANDIDATE_SUMMARY_BYTES: usize = 128;
pub const MAX_CREDENTIAL_FIELD_BYTES: usize = 16 * 1024;

const REQUEST_ID_LENGTH: usize = 32;
const MAX_ORIGIN_LENGTH: usize = 2_048;
const MAX_IDENTIFIER_LENGTH: usize = 256;

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum BrowserRequest {
    Connect {
        version: u16,
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Candidates {
        version: u16,
        #[serde(rename = "requestId")]
        request_id: String,
        origin: String,
    },
    Credential {
        version: u16,
        #[serde(rename = "requestId")]
        request_id: String,
        origin: String,
        #[serde(rename = "vaultSessionId")]
        vault_session_id: String,
        #[serde(rename = "entryId")]
        entry_id: String,
    },
}

impl BrowserRequest {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Connect {
                version,
                request_id,
            } => validate_common(*version, request_id),
            Self::Candidates {
                version,
                request_id,
                origin,
            } => {
                validate_common(*version, request_id)?;
                validate_bounded(origin, MAX_ORIGIN_LENGTH)
            }
            Self::Credential {
                version,
                request_id,
                origin,
                vault_session_id,
                entry_id,
            } => {
                validate_common(*version, request_id)?;
                validate_bounded(origin, MAX_ORIGIN_LENGTH)?;
                validate_token(vault_session_id)?;
                validate_bounded(entry_id, MAX_IDENTIFIER_LENGTH)
            }
        }
    }

    #[must_use]
    pub fn request_id(&self) -> &str {
        match self {
            Self::Connect { request_id, .. }
            | Self::Candidates { request_id, .. }
            | Self::Credential { request_id, .. } => request_id,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum CandidateText {
    Visible { value: String },
    Protected,
}

impl CandidateText {
    fn validate(&self) -> Result<(), ProtocolError> {
        match self {
            Self::Visible { value } => validate_bounded(value, MAX_CANDIDATE_SUMMARY_BYTES),
            Self::Protected => Ok(()),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Candidate {
    pub entry_id: String,
    pub title: CandidateText,
    pub username: CandidateText,
}

impl Candidate {
    fn validate(&self) -> Result<(), ProtocolError> {
        validate_bounded(&self.entry_id, MAX_IDENTIFIER_LENGTH)?;
        self.title.validate()?;
        self.username.validate()
    }
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VaultState {
    Locked,
    Ready,
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    DesktopUnavailable,
    ApprovalRequired,
    Denied,
    Locked,
    NoMatches,
    UnsupportedTarget,
    InvalidRequest,
    Internal,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum BrowserResponse {
    ApprovalPending {
        version: u16,
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Connected {
        version: u16,
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "vaultState")]
        vault_state: VaultState,
    },
    Candidates {
        version: u16,
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "vaultSessionId")]
        vault_session_id: String,
        candidates: Vec<Candidate>,
        truncated: bool,
    },
    Credential {
        version: u16,
        #[serde(rename = "requestId")]
        request_id: String,
        username: Zeroizing<String>,
        password: Zeroizing<String>,
    },
    Error {
        version: u16,
        #[serde(rename = "requestId")]
        request_id: String,
        code: ErrorCode,
    },
}

impl BrowserResponse {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        let (version, request_id) = match self {
            Self::ApprovalPending {
                version,
                request_id,
            }
            | Self::Connected {
                version,
                request_id,
                ..
            }
            | Self::Candidates {
                version,
                request_id,
                ..
            }
            | Self::Credential {
                version,
                request_id,
                ..
            }
            | Self::Error {
                version,
                request_id,
                ..
            } => (*version, request_id),
        };
        validate_common(version, request_id)?;
        match self {
            Self::Candidates {
                vault_session_id,
                candidates,
                ..
            } => {
                validate_token(vault_session_id)?;
                if candidates.len() > MAX_CANDIDATES {
                    return Err(ProtocolError::InvalidField);
                }
                candidates.iter().try_for_each(Candidate::validate)
            }
            Self::Credential {
                username, password, ..
            } => {
                validate_bounded(username, MAX_CREDENTIAL_FIELD_BYTES)?;
                validate_bounded(password, MAX_CREDENTIAL_FIELD_BYTES)
            }
            _ => Ok(()),
        }
    }

    #[must_use]
    pub fn request_id(&self) -> &str {
        match self {
            Self::ApprovalPending { request_id, .. }
            | Self::Connected { request_id, .. }
            | Self::Candidates { request_id, .. }
            | Self::Credential { request_id, .. }
            | Self::Error { request_id, .. } => request_id,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    UnsupportedVersion,
    InvalidRequestId,
    InvalidField,
}

fn validate_common(version: u16, request_id: &str) -> Result<(), ProtocolError> {
    if version != PROTOCOL_VERSION {
        return Err(ProtocolError::UnsupportedVersion);
    }
    validate_token(request_id).map_err(|_| ProtocolError::InvalidRequestId)
}

fn validate_token(value: &str) -> Result<(), ProtocolError> {
    if value.len() != REQUEST_ID_LENGTH
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ProtocolError::InvalidField);
    }
    Ok(())
}

fn validate_bounded(value: &str, maximum: usize) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > maximum || value.contains('\0') {
        return Err(ProtocolError::InvalidField);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_json::Value;

    use super::{BrowserRequest, BrowserResponse, HOST_NAME, PROTOCOL_VERSION};

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Contract {
        version: u16,
        host_name: String,
        fixtures: Fixtures,
    }

    #[derive(Deserialize)]
    struct Fixtures {
        requests: Vec<Value>,
        responses: Vec<Value>,
    }

    #[test]
    fn committed_contract_fixture_matches_rust_serialization() {
        let source = include_str!("../../../browser/native-contract-v1.json");
        let contract: Contract = match serde_json::from_str(source) {
            Ok(value) => value,
            Err(error) => panic!("contract must parse: {error}"),
        };
        assert_eq!(contract.version, PROTOCOL_VERSION);
        assert_eq!(contract.host_name, HOST_NAME);
        for fixture in contract.fixtures.requests {
            let parsed: BrowserRequest = match serde_json::from_value(fixture.clone()) {
                Ok(value) => value,
                Err(error) => panic!("request fixture must parse: {error}"),
            };
            assert!(parsed.validate().is_ok());
            let serialized = match serde_json::to_value(parsed) {
                Ok(value) => value,
                Err(error) => panic!("request fixture must serialize: {error}"),
            };
            assert_eq!(serialized, fixture);
        }
        for fixture in contract.fixtures.responses {
            let parsed: BrowserResponse = match serde_json::from_value(fixture.clone()) {
                Ok(value) => value,
                Err(error) => panic!("response fixture must parse: {error}"),
            };
            assert!(parsed.validate().is_ok());
            let serialized = match serde_json::to_value(parsed) {
                Ok(value) => value,
                Err(error) => panic!("response fixture must serialize: {error}"),
            };
            assert_eq!(serialized, fixture);
        }
    }

    #[test]
    fn unknown_fields_types_and_versions_fail_closed() {
        for value in [
            r#"{"version":1,"type":"unknown","requestId":"00112233445566778899aabbccddeeff"}"#,
            r#"{"version":2,"type":"connect","requestId":"00112233445566778899aabbccddeeff"}"#,
            r#"{"version":1,"type":"connect","requestId":"00112233445566778899aabbccddeeff","extra":true}"#,
        ] {
            let parsed = serde_json::from_str::<BrowserRequest>(value);
            assert!(
                parsed
                    .as_ref()
                    .map_or(true, |request| request.validate().is_err())
            );
        }
    }
}
