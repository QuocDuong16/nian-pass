use sync_provider_core::{CiphertextDigest, RemoteRevision};
use uuid::Uuid;

use crate::{
    LocalSnapshot,
    store_io::{
        atomic_write, atomic_write_json, read_private_file, remove_if_file, sync_directory,
    },
};

use super::{
    JOURNAL_METADATA, JournalPhase, JournalRecord, LoadedJournal, MetadataKind, MetadataSchema,
    RecoveryStatus, SCHEMA_VERSION, StoreError, SyncStore, validate_private_filename,
};

impl SyncStore {
    pub(crate) fn prepare_journal(
        &self,
        local: &LocalSnapshot,
        expected_remote_revision: Option<RemoteRevision>,
        candidate: &[u8],
    ) -> Result<JournalRecord, StoreError> {
        if self.recovery_status()? != RecoveryStatus::None {
            return Err(StoreError::ActiveJournal);
        }
        if local.source() != &self.source {
            return Err(StoreError::WrongSource);
        }
        let operation_id = Uuid::new_v4();
        let candidate_file = format!("candidate-{operation_id}.kdbx");
        atomic_write(&self.directory.join(&candidate_file), candidate)?;
        let record = JournalRecord {
            schema_version: SCHEMA_VERSION,
            profile_id: self.profile_id,
            source: self.source.clone(),
            target: self.target.clone(),
            operation_id,
            phase: JournalPhase::Prepared,
            expected_local_sha256: local.digest().clone(),
            expected_remote_revision,
            candidate_file,
            candidate_sha256: CiphertextDigest::of(candidate),
            committed_remote_revision: None,
        };
        self.write_journal(&record)?;
        Ok(record)
    }

    pub(crate) fn load_journal(&self) -> Result<Option<LoadedJournal>, StoreError> {
        match self.metadata_schema(JOURNAL_METADATA, MetadataKind::Journal)? {
            MetadataSchema::Missing => return Ok(None),
            MetadataSchema::Unsupported => return Err(StoreError::UnsupportedSchema),
            MetadataSchema::Current => {}
        }
        let Some(record): Option<JournalRecord> = self.read_metadata(
            &self.directory.join(JOURNAL_METADATA),
            MetadataKind::Journal,
        )?
        else {
            return Ok(None);
        };
        self.validate_identity(record.profile_id, &record.source, &record.target)?;
        validate_private_filename(&record.candidate_file, "candidate-")?;
        let candidate = read_private_file(&self.directory.join(&record.candidate_file))?;
        if CiphertextDigest::of(&candidate) != record.candidate_sha256 {
            return Err(StoreError::CorruptJournal);
        }
        Ok(Some(LoadedJournal { record, candidate }))
    }

    pub(crate) fn mark_remote_committed(
        &self,
        record: &mut JournalRecord,
        revision: RemoteRevision,
    ) -> Result<(), StoreError> {
        record.phase = JournalPhase::RemoteCommitted;
        record.committed_remote_revision = Some(revision);
        self.write_journal(record)
    }

    pub(crate) fn mark_local_committed(
        &self,
        record: &mut JournalRecord,
    ) -> Result<(), StoreError> {
        record.phase = JournalPhase::LocalCommitted;
        self.write_journal(record)
    }

    pub(crate) fn remove_journal(&self, record: &JournalRecord) -> Result<(), StoreError> {
        let current = self.load_journal()?.ok_or(StoreError::InvalidMetadata)?;
        if current.record.operation_id != record.operation_id {
            return Err(StoreError::InvalidMetadata);
        }
        remove_if_file(&self.directory.join(JOURNAL_METADATA))?;
        remove_if_file(&self.directory.join(&record.candidate_file))?;
        sync_directory(&self.directory)
    }

    fn write_journal(&self, record: &JournalRecord) -> Result<(), StoreError> {
        if let Some(current) = self.read_metadata::<JournalRecord>(
            &self.directory.join(JOURNAL_METADATA),
            MetadataKind::Journal,
        )? && current.operation_id != record.operation_id
        {
            return Err(StoreError::ActiveJournal);
        }
        atomic_write_json(&self.directory.join(JOURNAL_METADATA), record)
    }
}
