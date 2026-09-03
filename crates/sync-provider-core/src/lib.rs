//! Provider-neutral, conditional remote-object contract.
//!
//! Providers expose encrypted bytes and an opaque revision.  They never choose
//! merge winners and deliberately have no unconditional write operation.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Largest encrypted KDBX object accepted from a provider (64 MiB).
pub const MAX_REMOTE_CIPHERTEXT_BYTES: usize = 64 * 1024 * 1024;
/// Maximum retained provider error body. Production providers normally retain none.
pub const MAX_ERROR_BODY_BYTES: usize = 8 * 1024;
/// Bound for establishing one network connection.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Bound for one complete provider operation.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
/// Bound for one stalled response-body read.
pub const READ_TIMEOUT: Duration = Duration::from_secs(15);

/// Opaque compare-and-swap token supplied by one concrete provider.
///
/// It is intentionally not a digest API: callers may only preserve it and pass
/// it back to the same provider.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RemoteRevision(String);

impl RemoteRevision {
    /// Constructs a non-empty provider token.
    pub fn new(token: impl Into<String>) -> Result<Self, ProviderError> {
        let token = token.into();
        if token.is_empty() || token.len() > 4 * 1024 || token.contains(['\r', '\n']) {
            return Err(ProviderError::UnsafeProvider);
        }
        Ok(Self(token))
    }

    /// Borrows the token solely for a provider conditional request.
    #[must_use]
    pub fn as_provider_token(&self) -> &str {
        &self.0
    }
}

/// SHA-256 identity of exact encrypted KDBX bytes, separate from provider CAS.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CiphertextDigest(String);

impl CiphertextDigest {
    /// Hashes the exact ciphertext bytes.
    #[must_use]
    pub fn of(ciphertext: &[u8]) -> Self {
        let digest = Sha256::digest(ciphertext);
        let mut encoded = String::with_capacity(64);
        for byte in digest {
            use std::fmt::Write as _;
            write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
        }
        Self(encoded)
    }

    /// Parses one canonical lowercase SHA-256 string.
    pub fn parse(value: String) -> Result<Self, ProviderError> {
        if value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            Ok(Self(value))
        } else {
            Err(ProviderError::InvalidMetadata)
        }
    }

    /// Returns the canonical lowercase digest for private metadata.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Exact encrypted remote object and its current opaque CAS revision.
pub struct RemoteObject {
    ciphertext: Vec<u8>,
    revision: RemoteRevision,
}

impl RemoteObject {
    /// Constructs a bounded object returned by a concrete provider.
    pub fn new(ciphertext: Vec<u8>, revision: RemoteRevision) -> Result<Self, ProviderError> {
        if ciphertext.len() > MAX_REMOTE_CIPHERTEXT_BYTES {
            return Err(ProviderError::ObjectTooLarge);
        }
        Ok(Self {
            ciphertext,
            revision,
        })
    }

    /// Borrows exact encrypted KDBX bytes.
    #[must_use]
    pub fn ciphertext(&self) -> &[u8] {
        &self.ciphertext
    }

    /// Borrows the provider revision.
    #[must_use]
    pub const fn revision(&self) -> &RemoteRevision {
        &self.revision
    }

    /// Consumes the object into exact encrypted bytes and revision.
    #[must_use]
    pub fn into_parts(self) -> (Vec<u8>, RemoteRevision) {
        (self.ciphertext, self.revision)
    }
}

/// Result of a bounded remote read.
pub enum RemoteRead {
    /// The exact configured object is absent.
    Missing,
    /// The exact configured object exists.
    Present(RemoteObject),
}

/// Stable provider failures; no variant contains credentials or remote names.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum ProviderError {
    /// A concurrent writer changed or created the remote object.
    #[error("the remote vault changed during synchronization")]
    RemoteChanged,
    /// Delivery may have committed, so the caller must re-read before deciding.
    #[error("the remote write result is uncertain")]
    WriteResultUncertain,
    /// The endpoint cannot prove the required conditional-write contract.
    #[error("the provider does not support safe synchronization")]
    UnsupportedProvider,
    /// Observed response semantics were unsafe or internally inconsistent.
    #[error("the provider response is unsafe for synchronization")]
    UnsafeProvider,
    /// The endpoint or object configuration is invalid.
    #[error("the provider configuration is invalid")]
    InvalidConfiguration,
    /// Authentication or authorization was rejected.
    #[error("provider credentials were rejected")]
    AuthenticationFailed,
    /// The remote encrypted object exceeds the hard bound.
    #[error("the remote vault is too large")]
    ObjectTooLarge,
    /// Private synchronization metadata is malformed.
    #[error("synchronization metadata is invalid")]
    InvalidMetadata,
    /// A bounded network operation failed before a safe result was proven.
    #[error("the provider request failed")]
    Transport,
}

/// Exact safe remote object operations. No blind overwrite method exists.
#[allow(async_fn_in_trait)]
pub trait RemoteObjectProvider: Send + Sync {
    /// Reads the exact configured object and a safe opaque replacement revision.
    async fn read(&self) -> Result<RemoteRead, ProviderError>;

    /// Creates the object only if it is absent.
    async fn create_if_absent(&self, ciphertext: &[u8]) -> Result<RemoteRevision, ProviderError>;

    /// Replaces the object only if its current revision equals `expected`.
    async fn replace_if_revision(
        &self,
        expected: &RemoteRevision,
        ciphertext: &[u8],
    ) -> Result<RemoteRevision, ProviderError>;
}

#[cfg(test)]
mod tests {
    use super::{CiphertextDigest, ProviderError, RemoteRevision};

    #[test]
    fn digest_is_exact_and_canonical() {
        let left = CiphertextDigest::of(b"encrypted-a");
        let right = CiphertextDigest::of(b"encrypted-b");
        assert!(left != right);
        assert_eq!(left.as_str().len(), 64);
        assert!(CiphertextDigest::parse(left.as_str().to_owned()).is_ok());
        assert!(matches!(
            CiphertextDigest::parse("ABC".to_owned()),
            Err(ProviderError::InvalidMetadata)
        ));
    }

    #[test]
    fn revisions_reject_header_injection_and_empty_tokens() {
        assert!(RemoteRevision::new("\r\nAuthorization: secret").is_err());
        assert!(RemoteRevision::new("").is_err());
        assert!(RemoteRevision::new("\"opaque\"").is_ok());
    }
}
