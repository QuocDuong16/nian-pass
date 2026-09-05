use std::{fs, path::Path};

use serde::Deserialize;
use uuid::Uuid;

use crate::store_io::{read_optional_private_file, remove_if_file, sync_directory};

use super::{
    BASE_METADATA, JOURNAL_METADATA, MAX_METADATA_BYTES, RecoveryStatus, SCHEMA_VERSION,
    StoreError, SyncStore,
};

impl SyncStore {
    /// Classifies persisted state without network I/O or trusting unsupported fields.
    pub fn recovery_status(&self) -> Result<RecoveryStatus, StoreError> {
        let journal = self.metadata_schema(JOURNAL_METADATA, MetadataKind::Journal)?;
        let base = self.metadata_schema(BASE_METADATA, MetadataKind::Base)?;
        if journal == MetadataSchema::Unsupported || base == MetadataSchema::Unsupported {
            return Ok(RecoveryStatus::Unsupported);
        }
        if journal == MetadataSchema::Current {
            self.load_journal()?;
        }
        if base == MetadataSchema::Current {
            self.load_base()?;
        }
        Ok(if journal == MetadataSchema::Current {
            RecoveryStatus::Required
        } else {
            RecoveryStatus::None
        })
    }

    /// Explicitly discards only validated Nian Pass-owned state for this profile.
    pub fn reset_state(&self) -> Result<(), StoreError> {
        let mut ciphertext_files = Vec::new();
        for entry in fs::read_dir(&self.directory).map_err(StoreError::Io)? {
            let entry = entry.map_err(StoreError::Io)?;
            let file_type = entry.file_type().map_err(StoreError::Io)?;
            if file_type.is_symlink() || !file_type.is_file() {
                return Err(StoreError::InvalidMetadata);
            }
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| StoreError::InvalidMetadata)?;
            if name == BASE_METADATA || name == JOURNAL_METADATA {
                continue;
            }
            if is_private_state_ciphertext_filename(&name) {
                ciphertext_files.push(name);
            } else {
                return Err(StoreError::InvalidMetadata);
            }
        }

        // Metadata goes first so an interrupted reset can never trust a deleted payload.
        remove_if_file(&self.directory.join(JOURNAL_METADATA))?;
        remove_if_file(&self.directory.join(BASE_METADATA))?;
        for name in ciphertext_files {
            remove_if_file(&self.directory.join(name))?;
        }
        sync_directory(&self.directory)
    }

    pub(super) fn metadata_schema(
        &self,
        filename: &str,
        kind: MetadataKind,
    ) -> Result<MetadataSchema, StoreError> {
        let Some(bytes) =
            read_optional_private_file(&self.directory.join(filename), MAX_METADATA_BYTES)
                .map_err(|error| kind.map_read_error(error))?
        else {
            return Ok(MetadataSchema::Missing);
        };
        let envelope: SchemaEnvelope =
            serde_json::from_slice(&bytes).map_err(|_| kind.corrupt_error())?;
        Ok(if envelope.schema_version == SCHEMA_VERSION {
            MetadataSchema::Current
        } else {
            MetadataSchema::Unsupported
        })
    }

    pub(super) fn read_metadata<T: for<'de> Deserialize<'de>>(
        &self,
        path: &Path,
        kind: MetadataKind,
    ) -> Result<Option<T>, StoreError> {
        let Some(bytes) = read_optional_private_file(path, MAX_METADATA_BYTES)
            .map_err(|error| kind.map_read_error(error))?
        else {
            return Ok(None);
        };
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| kind.corrupt_error())
    }
}

#[derive(Deserialize)]
struct SchemaEnvelope {
    schema_version: u32,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(super) enum MetadataSchema {
    Missing,
    Current,
    Unsupported,
}

#[derive(Clone, Copy)]
pub(super) enum MetadataKind {
    Base,
    Journal,
}

impl MetadataKind {
    fn corrupt_error(self) -> StoreError {
        match self {
            Self::Base => StoreError::CorruptBase,
            Self::Journal => StoreError::CorruptJournal,
        }
    }

    fn map_read_error(self, error: StoreError) -> StoreError {
        match error {
            StoreError::InvalidMetadata => self.corrupt_error(),
            other => other,
        }
    }
}

fn is_private_state_ciphertext_filename(value: &str) -> bool {
    for prefix in ["base-", "candidate-"] {
        let Some(id) = value
            .strip_prefix(prefix)
            .and_then(|value| value.strip_suffix(".kdbx"))
        else {
            continue;
        };
        if Uuid::parse_str(id).is_ok_and(|uuid| uuid.get_version_num() == 4) {
            return true;
        }
    }
    false
}
