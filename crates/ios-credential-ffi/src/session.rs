use std::{
    collections::HashMap,
    fs::File,
    io::{BufReader, Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use credential_provider_core::{CredentialTarget, ProviderError};
use kdbx::{KdbxDocument, KdbxError};
use serde::Serialize;
use sha2::{Digest, Sha256};
use vault_core::{SecretString, SummaryText};
use zeroize::Zeroizing;

const MAX_MIRROR_BYTES: u64 = 1024 * 1024 * 1024;

pub(crate) struct ExtensionVaultSession {
    document: KdbxDocument,
    _generation: EncryptedGeneration,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) struct EncryptedGeneration {
    pub(crate) size: u64,
    pub(crate) sha256: [u8; 32],
}

pub(crate) enum SessionError {
    InvalidRequest,
    AutofillUnavailable,
    UnlockFailed,
    CredentialUnavailable,
    Internal,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidateDto<'a> {
    entry_id: &'a str,
    title: SummaryDto<'a>,
    username: SummaryDto<'a>,
}

#[derive(Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
enum SummaryDto<'a> {
    Missing,
    Visible(&'a str),
    Protected,
}

impl<'a> From<&'a SummaryText> for SummaryDto<'a> {
    fn from(value: &'a SummaryText) -> Self {
        match value {
            SummaryText::Missing => Self::Missing,
            SummaryText::Visible(text) => Self::Visible(text),
            SummaryText::Protected => Self::Protected,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityDto<'a> {
    record_identifier: &'a str,
    service_identifier: &'a str,
    username: &'a str,
}

pub(crate) struct CredentialBytes {
    pub(crate) username: Zeroizing<Vec<u8>>,
    pub(crate) password: Zeroizing<Vec<u8>>,
}

impl ExtensionVaultSession {
    fn open(
        app_group_root: &Path,
        mirror_relative_name: &Path,
        password: Zeroizing<String>,
        expected: EncryptedGeneration,
    ) -> Result<Self, SessionError> {
        let path = confined_mirror_path(app_group_root, mirror_relative_name)?;
        let (mut mirror, actual) = verified_mirror(&path)?;
        if actual != expected {
            return Err(SessionError::AutofillUnavailable);
        }
        let credential = SecretString::new(password.to_string());
        let document = KdbxDocument::open_reader(&mut mirror, credential.expose_secret())
            .map_err(map_open_error)?;
        Ok(Self {
            document,
            _generation: actual,
        })
    }

    fn candidates_json(&self, target: &CredentialTarget) -> Result<Vec<u8>, SessionError> {
        let candidates = credential_provider_core::candidates(&self.document, target)
            .map_err(map_provider_error)?;
        let payload: Vec<_> = candidates
            .iter()
            .map(|candidate| CandidateDto {
                entry_id: candidate.entry_id(),
                title: candidate.title().into(),
                username: candidate.username().into(),
            })
            .collect();
        serde_json::to_vec(&payload).map_err(|_| SessionError::Internal)
    }

    fn identities_json(&self) -> Result<Vec<u8>, SessionError> {
        let identities = credential_provider_core::password_identities(&self.document)
            .map_err(map_provider_error)?;
        let payload: Vec<_> = identities
            .iter()
            .map(|identity| IdentityDto {
                record_identifier: identity.record_identifier(),
                service_identifier: identity.service_identifier(),
                username: identity.username(),
            })
            .collect();
        serde_json::to_vec(&payload).map_err(|_| SessionError::Internal)
    }

    fn credential(
        &self,
        entry_id: &str,
        target: &CredentialTarget,
    ) -> Result<CredentialBytes, SessionError> {
        let credential = credential_provider_core::credential(&self.document, entry_id, target)
            .map_err(map_provider_error)?;
        let (username, password) = credential.into_secrets();
        Ok(CredentialBytes {
            username: Zeroizing::new(username.expose_secret().as_bytes().to_vec()),
            password: Zeroizing::new(password.expose_secret().as_bytes().to_vec()),
        })
    }
}

fn sessions() -> &'static Mutex<HashMap<u64, ExtensionVaultSession>> {
    static SESSIONS: OnceLock<Mutex<HashMap<u64, ExtensionVaultSession>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn open(
    app_group_root: PathBuf,
    mirror_relative_name: PathBuf,
    password: Zeroizing<String>,
    expected: EncryptedGeneration,
) -> Result<u64, SessionError> {
    let session =
        ExtensionVaultSession::open(&app_group_root, &mirror_relative_name, password, expected)?;
    let mut sessions = sessions().lock().map_err(|_| SessionError::Internal)?;
    for _ in 0..32 {
        let mut bytes = [0_u8; 8];
        getrandom::fill(&mut bytes).map_err(|_| SessionError::Internal)?;
        let handle = u64::from_ne_bytes(bytes);
        if handle != 0 && !sessions.contains_key(&handle) {
            sessions.insert(handle, session);
            return Ok(handle);
        }
    }
    Err(SessionError::Internal)
}

pub(crate) fn close(handle: u64) -> Result<(), SessionError> {
    if handle == 0 {
        return Err(SessionError::InvalidRequest);
    }
    sessions()
        .lock()
        .map_err(|_| SessionError::Internal)?
        .remove(&handle)
        .map(|_| ())
        .ok_or(SessionError::CredentialUnavailable)
}

pub(crate) fn candidates_json(
    handle: u64,
    target: &CredentialTarget,
) -> Result<Vec<u8>, SessionError> {
    sessions()
        .lock()
        .map_err(|_| SessionError::Internal)?
        .get(&handle)
        .ok_or(SessionError::CredentialUnavailable)?
        .candidates_json(target)
}

pub(crate) fn identities_json(handle: u64) -> Result<Vec<u8>, SessionError> {
    sessions()
        .lock()
        .map_err(|_| SessionError::Internal)?
        .get(&handle)
        .ok_or(SessionError::CredentialUnavailable)?
        .identities_json()
}

pub(crate) fn credential(
    handle: u64,
    entry_id: &str,
    target: &CredentialTarget,
) -> Result<CredentialBytes, SessionError> {
    sessions()
        .lock()
        .map_err(|_| SessionError::Internal)?
        .get(&handle)
        .ok_or(SessionError::CredentialUnavailable)?
        .credential(entry_id, target)
}

fn confined_mirror_path(root: &Path, relative: &Path) -> Result<PathBuf, SessionError> {
    if !root.is_absolute() || relative.as_os_str().is_empty() || relative.is_absolute() {
        return Err(SessionError::InvalidRequest);
    }
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(SessionError::InvalidRequest);
    }
    Ok(root.join(relative))
}

fn verified_mirror(path: &Path) -> Result<(BufReader<File>, EncryptedGeneration), SessionError> {
    let file = File::open(path).map_err(|_| SessionError::AutofillUnavailable)?;
    let metadata = file
        .metadata()
        .map_err(|_| SessionError::AutofillUnavailable)?;
    if !metadata.is_file() || metadata.len() > MAX_MIRROR_BYTES {
        return Err(SessionError::AutofillUnavailable);
    }
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| SessionError::AutofillUnavailable)?;
        if count == 0 {
            break;
        }
        size = size
            .checked_add(u64::try_from(count).map_err(|_| SessionError::AutofillUnavailable)?)
            .ok_or(SessionError::AutofillUnavailable)?;
        if size > MAX_MIRROR_BYTES {
            return Err(SessionError::AutofillUnavailable);
        }
        hasher.update(&buffer[..count]);
    }
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|_| SessionError::AutofillUnavailable)?;
    Ok((
        reader,
        EncryptedGeneration {
            size,
            sha256: hasher.finalize().into(),
        },
    ))
}

fn map_open_error(error: KdbxError) -> SessionError {
    match error {
        KdbxError::InvalidCredentials => SessionError::UnlockFailed,
        KdbxError::Io(_) => SessionError::AutofillUnavailable,
        _ => SessionError::AutofillUnavailable,
    }
}

fn map_provider_error(error: ProviderError) -> SessionError {
    match error {
        ProviderError::InvalidTarget => SessionError::InvalidRequest,
        ProviderError::CredentialUnavailable => SessionError::CredentialUnavailable,
        ProviderError::Internal => SessionError::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::confined_mirror_path;
    use std::path::Path;

    #[test]
    fn mirror_relative_name_cannot_escape_app_group() {
        let root = Path::new("/private/app-group");
        let confined = match confined_mirror_path(root, Path::new("AutoFill/vault.kdbx")) {
            Ok(value) => value,
            Err(_) => panic!("confined path must be accepted"),
        };
        assert_eq!(
            confined,
            Path::new("/private/app-group/AutoFill/vault.kdbx")
        );
        for value in [
            "",
            "../vault.kdbx",
            "AutoFill/../vault.kdbx",
            "/tmp/vault.kdbx",
        ] {
            assert!(confined_mirror_path(root, Path::new(value)).is_err());
        }
        assert!(confined_mirror_path(Path::new("relative-root"), Path::new("vault.kdbx")).is_err());
    }
}
