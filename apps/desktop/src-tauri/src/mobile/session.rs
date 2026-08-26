use std::path::Path;

use kdbx::{KdbxDocument, KdbxError};
use vault_core::{EntryId, SecretString};

use crate::dto::{EntryDetailDto, VaultSnapshotDto};

use super::MobileError;

/// Decrypted, read-only mobile state with no source or persistence semantics.
pub(super) struct MobileReadSession {
    document: KdbxDocument,
}

impl MobileReadSession {
    pub(super) fn open_candidate(
        staged_path: &Path,
        credential: &SecretString,
    ) -> Result<(Self, VaultSnapshotDto), MobileError> {
        let document =
            KdbxDocument::open(staged_path, credential.expose_secret()).map_err(map_open_error)?;
        let snapshot = document
            .projection()
            .map(|vault| VaultSnapshotDto::from_vault(&vault, false))
            .map_err(map_open_error)?;
        Ok((Self { document }, snapshot))
    }

    pub(super) fn snapshot(&self) -> Result<VaultSnapshotDto, MobileError> {
        self.document
            .projection()
            .map(|vault| VaultSnapshotDto::from_vault(&vault, false))
            .map_err(|_| MobileError::Internal)
    }

    pub(super) fn entry_detail(&self, entry_id: &str) -> Result<EntryDetailDto, MobileError> {
        let id = EntryId::new(entry_id);
        let projection = self
            .document
            .projection()
            .map_err(|_| MobileError::Internal)?;
        let entry = projection
            .find_entry(&id)
            .ok_or(MobileError::EntryNotFound)?;
        let fields = self.document.custom_fields(&id).map_err(map_detail_error)?;
        Ok(EntryDetailDto::from_entry(entry, &fields))
    }
}

fn map_detail_error(error: KdbxError) -> MobileError {
    match error {
        KdbxError::EntryNotFound => MobileError::EntryNotFound,
        _ => MobileError::Internal,
    }
}

fn map_open_error(error: KdbxError) -> MobileError {
    match error {
        KdbxError::InvalidCredentials => MobileError::UnlockFailed,
        KdbxError::InvalidKdbx | KdbxError::UnsupportedFormat | KdbxError::Conversion(_) => {
            MobileError::UnsupportedVault
        }
        _ => MobileError::Internal,
    }
}

#[cfg(test)]
mod tests {
    use std::io;

    use kdbx::KdbxError;

    use super::{MobileError, map_detail_error, map_open_error};

    #[test]
    fn unexpected_kdbx_errors_map_only_to_internal() {
        assert!(matches!(
            map_open_error(KdbxError::Io(io::Error::other("private detail"))),
            MobileError::Internal
        ));
        assert!(matches!(
            map_detail_error(KdbxError::EntryNotFound),
            MobileError::EntryNotFound
        ));
        assert!(matches!(
            map_detail_error(KdbxError::Io(io::Error::other("private detail"))),
            MobileError::Internal
        ));
    }
}
