//! Local unlocked vault sessions with verified persistence. This crate owns
//! filesystem transactions, seals `keepass-rs`, and never retains passwords.

mod fingerprint;
mod mutations;
mod platform;
mod sync_persistence;
pub use fingerprint::FileFingerprint;
use kdbx::{KdbxDocument, KdbxError};
use std::{
    ffi::OsString,
    fs::{self, File, Metadata, OpenOptions},
    io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
pub use sync_persistence::EncryptedVaultSnapshot;
use thiserror::Error;
use vault_core::{SecretString, Vault};

const SAVE_TEMP_PREFIX: &str = ".nian-pass-save-";
const BACKUP_TEMP_PREFIX: &str = ".nian-pass-backup-";
const TEMP_SUFFIX: &str = ".tmp";
const TEMP_CREATE_ATTEMPTS: usize = 128;
/// An unlocked local session whose canonical target cannot change.
pub struct VaultSession {
    path: PathBuf,
    document: KdbxDocument,
    source_fingerprint: FileFingerprint,
    saved_revision: u64,
}

impl VaultSession {
    /// Opens an existing regular vault file into a stable unlocked session.
    /// Final-component symlinks and non-regular files are rejected. The file is
    /// fingerprinted before and after parsing through one handle, and the path
    /// is fingerprinted once more, so an unstable source cannot seed a session.
    pub fn open(path: impl AsRef<Path>, credential: &SecretString) -> Result<Self, SessionError> {
        let path = canonical_regular_file(path.as_ref())?;
        let (document, source_fingerprint) = open_stable_document(&path, credential)?;

        let saved_revision = document.revision();
        Ok(Self {
            path,
            document,
            source_fingerprint,
            saved_revision,
        })
    }

    /// Returns a fresh dependency-neutral snapshot of the current document.
    pub fn projection(&self) -> Result<Vault, SessionError> {
        self.document.projection().map_err(SessionError::Kdbx)
    }

    /// Returns whether a real in-memory mutation has occurred since open/save.
    #[must_use]
    pub fn is_dirty(&self) -> bool {
        self.document.has_changes_since(self.saved_revision)
    }

    /// Returns the canonical source path owned by this session.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Borrows the complete opaque KDBX document through its narrow adapter API.
    #[must_use]
    pub const fn document(&self) -> &KdbxDocument {
        &self.document
    }
    /// Mutably borrows the document; public mutations maintain revision.
    #[must_use]
    pub const fn document_mut(&mut self) -> &mut KdbxDocument {
        &mut self.document
    }

    /// Saves a dirty session to its canonical source through a verified atomic
    /// replacement transaction. A clean session performs no filesystem I/O.
    pub fn save(&mut self, credential: &SecretString) -> Result<SaveOutcome, SessionError> {
        self.save_with_observer(credential, &mut NoopObserver)
    }

    /// Consumes the session and drops its decrypted database representation.
    /// This does not autosave and cannot promise physical erasure of every
    /// plaintext allocation previously owned by `keepass-rs`.
    pub fn lock(self) {}

    fn save_with_observer(
        &mut self,
        credential: &SecretString,
        observer: &mut impl SaveObserver,
    ) -> Result<SaveOutcome, SessionError> {
        if !self.is_dirty() {
            return Ok(SaveOutcome::Unchanged);
        }
        if !platform::SAVE_SUPPORTED {
            return Err(SessionError::UnsupportedPersistencePlatform);
        }
        #[cfg(unix)]
        let source_metadata = validate_current_target(&self.path)?;
        #[cfg(windows)]
        validate_current_target(&self.path)?;
        self.require_source_unchanged()?;
        self.verify_save_credential(credential)?;
        let parent = self.path.parent().ok_or(SessionError::UnsupportedPath)?;
        let mut serialized = ManagedTemp::create(parent, SAVE_TEMP_PREFIX)?;
        observer.checkpoint(SavePhase::AfterTempCreate, serialized.path())?;
        {
            let mut writer = BufWriter::new(serialized.file_mut()?);
            observer.serialize(&self.document, &mut writer, credential)?;
            writer.flush().map_err(SessionError::WriteTemp)?;
        }
        observer.checkpoint(SavePhase::AfterSerialize, serialized.path())?;
        serialized
            .file_mut()?
            .sync_all()
            .map_err(SessionError::SyncTemp)?;
        serialized.close();
        observer.checkpoint(SavePhase::AfterTempSync, serialized.path())?;
        let reopened_temp = open_document(serialized.path(), credential)
            .map_err(SessionError::TempVerificationFailed)?;
        self.document
            .verify_semantic_equivalence(&reopened_temp)
            .map_err(SessionError::TempVerificationFailed)?;
        observer.checkpoint(SavePhase::AfterTempVerify, serialized.path())?;
        self.require_source_unchanged()?;
        observer.checkpoint(SavePhase::AfterFinalExternalCheck, &self.path)?;
        #[cfg(unix)]
        {
            apply_restricted_permissions(serialized.path(), &source_metadata)
                .map_err(SessionError::WriteTemp)?;
            sync_path(serialized.path()).map_err(SessionError::SyncTemp)?;
        }
        let backup_path = backup_path(&self.path);
        #[cfg(unix)]
        let prepared_backup = self.prepare_backup(&backup_path, &source_metadata, observer)?;
        // A third check narrows the unavoidable cooperative-locking race and
        // detects changes that happened while the exact backup was prepared.
        observer.checkpoint(SavePhase::BeforeTargetReplace, serialized.path())?;
        self.require_source_unchanged()?;
        #[cfg(unix)]
        observer
            .replace_primary(serialized.path(), &self.path)
            .map_err(SessionError::AtomicReplaceFailed)?;
        #[cfg(windows)]
        platform::replace_windows_with_backup(
            serialized.path(),
            &self.path,
            &backup_path,
            &self.source_fingerprint,
        )?;
        serialized.disarm();
        #[cfg(unix)]
        let post_replace_observer = observer.checkpoint(SavePhase::AfterTargetReplace, &self.path);
        let durability = observer.sync_parent(parent, true);
        let final_open = open_stable_document_with_hook(&self.path, credential, || {
            observer.checkpoint(SavePhase::AfterFinalDocumentRead, &self.path)
        })
        .map_err(map_final_open_error)?;
        let (final_document, final_fingerprint) = final_open;
        self.document
            .verify_semantic_equivalence(&final_document)
            .map_err(SessionError::FinalVerificationFailed)?;
        self.source_fingerprint = final_fingerprint;
        self.saved_revision = self.document.revision();
        #[cfg(unix)]
        self.commit_backup(prepared_backup, &backup_path, parent, observer)?;
        #[cfg(unix)]
        post_replace_observer?;
        match durability {
            Ok(()) => Ok(SaveOutcome::Saved),
            Err(source) => Err(SessionError::DurabilityUncertain(source)),
        }
    }
    fn require_source_unchanged(&self) -> Result<(), SessionError> {
        validate_current_target(&self.path)?;
        if fingerprint_path(&self.path)? == self.source_fingerprint {
            Ok(())
        } else {
            Err(SessionError::ExternalModificationDetected)
        }
    }
    fn verify_save_credential(&self, credential: &SecretString) -> Result<(), SessionError> {
        match open_document(&self.path, credential) {
            Ok(_) => Ok(()),
            Err(KdbxError::InvalidCredentials) => Err(SessionError::CredentialMismatch),
            Err(error) => Err(SessionError::CredentialVerificationFailed(error)),
        }
    }
    fn prepare_backup(
        &self,
        backup_path: &Path,
        source_metadata: &Metadata,
        observer: &mut impl SaveObserver,
    ) -> Result<ManagedTemp, SessionError> {
        let parent = self.path.parent().ok_or(SessionError::UnsupportedPath)?;
        reject_symlink_if_present(backup_path).map_err(SessionError::BackupFailed)?;
        let mut backup =
            ManagedTemp::create(parent, BACKUP_TEMP_PREFIX).map_err(|error| match error {
                SessionError::TempCreateFailed(source) => SessionError::BackupTempFailed(source),
                other => other,
            })?;

        let copied_fingerprint = {
            let source = open_existing_file(&self.path).map_err(SessionError::BackupFailed)?;
            ensure_handle_regular(&source)
                .map_err(|error| match error {
                    SessionError::UnsupportedPath => io::Error::other("unsupported backup source"),
                    SessionError::ReadSource(source) => source,
                    _ => io::Error::other("could not validate backup source"),
                })
                .map_err(SessionError::BackupFailed)?;
            copy_and_fingerprint(source, backup.file_mut()?).map_err(SessionError::BackupFailed)?
        };

        if copied_fingerprint != self.source_fingerprint {
            return Err(SessionError::ExternalModificationDetected);
        }
        observer.checkpoint(SavePhase::AfterBackupWrite, backup.path())?;
        backup
            .file_mut()?
            .flush()
            .map_err(SessionError::BackupFailed)?;
        backup
            .file_mut()?
            .sync_all()
            .map_err(SessionError::BackupFailed)?;
        backup.close();
        apply_restricted_permissions(backup.path(), source_metadata)
            .map_err(SessionError::BackupFailed)?;
        sync_path(backup.path()).map_err(SessionError::BackupFailed)?;

        if fingerprint_path_for_backup(backup.path())? != self.source_fingerprint {
            return Err(SessionError::BackupVerificationFailed);
        }

        Ok(backup)
    }

    fn commit_backup(
        &self,
        mut backup: ManagedTemp,
        backup_path: &Path,
        parent: &Path,
        observer: &mut impl SaveObserver,
    ) -> Result<(), SessionError> {
        reject_symlink_if_present(backup_path).map_err(SessionError::SavedButBackupUpdateFailed)?;
        observer
            .commit_backup(backup.path(), backup_path)
            .map_err(SessionError::SavedButBackupUpdateFailed)?;
        backup.disarm();
        observer.checkpoint(SavePhase::AfterBackupCommit, backup_path)?;
        observer
            .sync_parent(parent, false)
            .map_err(SessionError::SavedButBackupDurabilityUncertain)
    }
}

/// Outcome of an ordinary save request.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum SaveOutcome {
    /// No mutation occurred, so no filesystem operation was performed.
    Unchanged,
    /// The dirty document was verified and installed at the canonical target.
    Saved,
}

/// Errors returned while opening or safely persisting a local vault session.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum SessionError {
    /// The path is a symlink, missing, or not an existing regular file.
    #[error("the vault path is not a supported regular file")]
    UnsupportedPath,

    /// Safe local replacement is unavailable on this operating system.
    #[error("safe vault persistence is not supported on this platform")]
    UnsupportedPersistencePlatform,

    /// Sync requires a clean Rust-owned session.
    #[error("save before syncing")]
    UnsavedChanges,
    /// The encrypted source file could not be read.
    #[error("could not read the vault file")]
    ReadSource(#[source] io::Error),

    /// The KDBX adapter rejected an open, mutation, or serialization operation.
    #[error("could not process the vault contents")]
    Kdbx(#[source] KdbxError),

    /// Complete encrypted source bytes no longer match the session baseline.
    #[error("the vault changed outside this session")]
    ExternalModificationDetected,

    /// The ordinary-save credential cannot open the unchanged current source.
    #[error("the save credential does not match the current vault")]
    CredentialMismatch,

    /// Credential authentication could not be completed for another reason.
    #[error("could not verify the save credential")]
    CredentialVerificationFailed(#[source] KdbxError),

    /// A same-directory serialization temp file could not be created.
    #[error("could not create the temporary vault file")]
    TempCreateFailed(#[source] io::Error),

    /// Secure random bytes for a temporary filename were unavailable.
    #[error("could not create the temporary vault file")]
    TempRandomFailed(#[source] getrandom::Error),

    /// The serialized temporary vault could not be written or flushed.
    #[error("could not write the temporary vault file")]
    WriteTemp(#[source] io::Error),

    /// The serialized temporary vault could not be durably synced.
    #[error("could not sync the temporary vault file")]
    SyncTemp(#[source] io::Error),

    /// The serialized temporary vault did not reopen with equal semantics.
    #[error("serialized vault did not preserve database semantics")]
    TempVerificationFailed(#[source] KdbxError),

    /// A same-directory backup temp file could not be created.
    #[error("could not create the temporary backup file")]
    BackupTempFailed(#[source] io::Error),

    /// The exact previous ciphertext backup could not be safely committed.
    #[error("could not update the previous vault backup")]
    BackupFailed(#[source] io::Error),

    /// The prepared backup did not equal the previous source ciphertext.
    #[error("the previous vault backup could not be verified")]
    BackupVerificationFailed,

    /// The primary is verified and the session is clean, but the previous
    /// generation backup could not be advanced.
    #[error("the vault was saved but its previous-version backup was not updated")]
    SavedButBackupUpdateFailed(#[source] io::Error),

    /// The primary and backup were installed, but the backup directory entry
    /// could not be durably synced.
    #[error("the vault was saved but backup durability is uncertain")]
    SavedButBackupDurabilityUncertain(#[source] io::Error),

    /// The verified temp could not atomically replace the canonical target.
    #[error("could not atomically replace the vault file")]
    AtomicReplaceFailed(#[source] io::Error),

    /// Replacement occurred, but reopening the final target did not prove it.
    #[error("the replaced vault file could not be verified")]
    FinalVerificationFailed(#[source] KdbxError),

    /// Replacement occurred, but the final target could not be read stably.
    #[error("the replaced vault file could not be read for verification")]
    FinalReadFailed(#[source] io::Error),

    /// Replacement occurred, but another writer changed the target during
    /// final verification. No unverified fingerprint was accepted.
    #[error("the replaced vault changed again during final verification")]
    FinalExternalModificationDetected,

    /// The new content is present and the session baseline was updated, but
    /// crash durability is uncertain because syncing the directory failed.
    #[error("the vault was replaced but filesystem durability is uncertain")]
    DurabilityUncertain(#[source] io::Error),

    #[cfg(test)]
    #[error("an injected save failure occurred")]
    InjectedFailure,
}

impl SessionError {
    /// Returns whether an open failed because the supplied credential was rejected.
    ///
    /// This classification lets application adapters map authentication failure
    /// without depending directly on the sealed KDBX adapter or exposing its
    /// parser and cryptography details.
    #[must_use]
    pub const fn is_open_credential_rejected(&self) -> bool {
        matches!(self, Self::Kdbx(KdbxError::InvalidCredentials))
    }

    /// Returns whether an open target is not a supported local KDBX vault.
    ///
    /// The classification deliberately groups path, read, malformed-file, and
    /// unsupported-format failures so desktop errors remain path-free.
    #[must_use]
    pub const fn is_unsupported_open_target(&self) -> bool {
        matches!(
            self,
            Self::UnsupportedPath
                | Self::ReadSource(_)
                | Self::Kdbx(KdbxError::InvalidKdbx | KdbxError::UnsupportedFormat)
        )
    }
}

fn canonical_regular_file(path: &Path) -> Result<PathBuf, SessionError> {
    let metadata = fs::symlink_metadata(path).map_err(SessionError::ReadSource)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(SessionError::UnsupportedPath);
    }

    let canonical = fs::canonicalize(path).map_err(SessionError::ReadSource)?;
    let canonical_metadata = fs::symlink_metadata(&canonical).map_err(SessionError::ReadSource)?;
    if canonical_metadata.file_type().is_symlink() || !canonical_metadata.file_type().is_file() {
        return Err(SessionError::UnsupportedPath);
    }
    Ok(canonical)
}

fn validate_current_target(path: &Path) -> Result<Metadata, SessionError> {
    let metadata = fs::symlink_metadata(path).map_err(SessionError::ReadSource)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(SessionError::UnsupportedPath);
    }
    Ok(metadata)
}

fn ensure_handle_regular(file: &File) -> Result<(), SessionError> {
    let metadata = file.metadata().map_err(SessionError::ReadSource)?;
    if metadata.file_type().is_file() {
        Ok(())
    } else {
        Err(SessionError::UnsupportedPath)
    }
}

fn open_stable_document(
    path: &Path,
    credential: &SecretString,
) -> Result<(KdbxDocument, FileFingerprint), SessionError> {
    open_stable_document_with_hook(path, credential, || Ok(()))
}

fn open_stable_document_with_hook(
    path: &Path,
    credential: &SecretString,
    after_document_read: impl FnOnce() -> Result<(), SessionError>,
) -> Result<(KdbxDocument, FileFingerprint), SessionError> {
    validate_current_target(path)?;
    let mut source = open_existing_file(path).map_err(SessionError::ReadSource)?;
    ensure_handle_regular(&source)?;

    let fingerprint_before =
        FileFingerprint::from_reader(&mut source).map_err(SessionError::ReadSource)?;
    source
        .seek(SeekFrom::Start(0))
        .map_err(SessionError::ReadSource)?;
    let document = KdbxDocument::open_reader(&mut source, credential.expose_secret())
        .map_err(SessionError::Kdbx)?;
    source
        .seek(SeekFrom::Start(0))
        .map_err(SessionError::ReadSource)?;
    let fingerprint_after =
        FileFingerprint::from_reader(&mut source).map_err(SessionError::ReadSource)?;

    if fingerprint_before != fingerprint_after {
        return Err(SessionError::ExternalModificationDetected);
    }

    after_document_read()?;
    validate_current_target(path)?;
    if fingerprint_before != fingerprint_path(path)? {
        return Err(SessionError::ExternalModificationDetected);
    }

    Ok((document, fingerprint_before))
}

fn map_final_open_error(error: SessionError) -> SessionError {
    match error {
        SessionError::Kdbx(source) => SessionError::FinalVerificationFailed(source),
        SessionError::ReadSource(source) => SessionError::FinalReadFailed(source),
        SessionError::ExternalModificationDetected | SessionError::UnsupportedPath => {
            SessionError::FinalExternalModificationDetected
        }
        other => other,
    }
}

fn fingerprint_path(path: &Path) -> Result<FileFingerprint, SessionError> {
    let mut file = open_existing_file(path).map_err(SessionError::ReadSource)?;
    ensure_handle_regular(&file)?;
    FileFingerprint::from_reader(&mut file).map_err(SessionError::ReadSource)
}

fn fingerprint_path_for_backup(path: &Path) -> Result<FileFingerprint, SessionError> {
    let mut file = open_existing_file(path).map_err(SessionError::BackupFailed)?;
    FileFingerprint::from_reader(&mut file).map_err(SessionError::BackupFailed)
}

fn open_document(path: &Path, credential: &SecretString) -> Result<KdbxDocument, KdbxError> {
    KdbxDocument::open(path, credential.expose_secret())
}

fn backup_path(source: &Path) -> PathBuf {
    let mut path: OsString = source.as_os_str().to_owned();
    path.push(".bak");
    PathBuf::from(path)
}

fn reject_symlink_if_present(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(io::Error::other("refusing to replace a symlink"))
        }
        Ok(metadata) if !metadata.file_type().is_file() => {
            Err(io::Error::other("backup destination is not a regular file"))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn copy_and_fingerprint(mut source: File, destination: &mut File) -> io::Result<FileFingerprint> {
    let mut digesting_reader = DigestingReader::new(BufReader::new(&mut source));
    io::copy(&mut digesting_reader, destination)?;
    Ok(digesting_reader.finish())
}

struct DigestingReader<R> {
    inner: R,
    digest: sha2::Sha256,
    size: u64,
}

impl<R> DigestingReader<R> {
    fn new(inner: R) -> Self {
        use sha2::Digest;

        Self {
            inner,
            digest: sha2::Sha256::new(),
            size: 0,
        }
    }

    fn finish(self) -> FileFingerprint {
        use sha2::Digest;

        FileFingerprint::from_parts(self.size, self.digest.finalize().into())
    }
}

impl<R: Read> Read for DigestingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        use sha2::Digest;

        let count = self.inner.read(buffer)?;
        self.size = self
            .size
            .checked_add(count as u64)
            .ok_or_else(|| io::Error::other("vault size exceeded supported range"))?;
        self.digest.update(&buffer[..count]);
        Ok(count)
    }
}

#[cfg(unix)]
fn sync_path(path: &Path) -> io::Result<()> {
    open_existing_file(path)?.sync_all()
}

#[cfg(unix)]
fn open_existing_file(path: &Path) -> io::Result<File> {
    use rustix::fs::{CWD, Mode, OFlags, openat};

    openat(
        CWD,
        path,
        OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(Into::into)
}

#[cfg(windows)]
fn open_existing_file(path: &Path) -> io::Result<File> {
    File::open(path)
}

#[cfg(windows)]
fn sync_path(_path: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "safe Windows metadata sync is unavailable",
    ))
}

#[cfg(unix)]
fn apply_restricted_permissions(path: &Path, source: &Metadata) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mode = source.permissions().mode() & 0o600;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(windows)]
fn apply_restricted_permissions(_path: &Path, _source: &Metadata) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "safe Windows security metadata preservation is unavailable",
    ))
}

struct ManagedTemp {
    path: PathBuf,
    file: Option<File>,
    armed: bool,
}

impl ManagedTemp {
    fn create(parent: &Path, prefix: &str) -> Result<Self, SessionError> {
        for _ in 0..TEMP_CREATE_ATTEMPTS {
            let name = random_temp_name(prefix)?;
            let path = parent.join(name);
            match open_private_new_file(&path) {
                Ok(file) => {
                    return Ok(Self {
                        path,
                        file: Some(file),
                        armed: true,
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(SessionError::TempCreateFailed(error)),
            }
        }
        Err(SessionError::TempCreateFailed(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a unique temporary filename",
        )))
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn file_mut(&mut self) -> Result<&mut File, SessionError> {
        self.file.as_mut().ok_or_else(|| {
            SessionError::WriteTemp(io::Error::other("temporary file is already closed"))
        })
    }

    fn close(&mut self) {
        self.file.take();
    }

    fn disarm(&mut self) {
        self.file.take();
        self.armed = false;
    }
}

impl Drop for ManagedTemp {
    fn drop(&mut self) {
        self.file.take();
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn random_temp_name(prefix: &str) -> Result<OsString, SessionError> {
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(SessionError::TempRandomFailed)?;
    let mut name = String::with_capacity(prefix.len() + random.len() * 2 + TEMP_SUFFIX.len());
    name.push_str(prefix);
    for byte in random {
        use std::fmt::Write as _;
        write!(&mut name, "{byte:02x}").expect("writing to String cannot fail");
    }
    name.push_str(TEMP_SUFFIX);
    Ok(OsString::from(name))
}

#[cfg(unix)]
fn open_private_new_file(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

#[cfg(windows)]
fn open_private_new_file(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(path)
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum SavePhase {
    AfterTempCreate,
    AfterSerialize,
    AfterTempSync,
    AfterTempVerify,
    AfterFinalExternalCheck,
    AfterBackupWrite,
    BeforeTargetReplace,
    AfterTargetReplace,
    AfterFinalDocumentRead,
    AfterBackupCommit,
}

trait SaveObserver {
    fn checkpoint(&mut self, _phase: SavePhase, _path: &Path) -> Result<(), SessionError> {
        Ok(())
    }

    fn serialize(
        &mut self,
        document: &KdbxDocument,
        destination: &mut impl Write,
        credential: &SecretString,
    ) -> Result<(), SessionError> {
        document
            .save_to_writer(destination, credential.expose_secret())
            .map_err(SessionError::Kdbx)
    }

    fn sync_parent(&mut self, parent: &Path, _after_target_replace: bool) -> io::Result<()> {
        platform::sync_parent(parent)
    }

    fn replace_primary(&mut self, prepared: &Path, destination: &Path) -> io::Result<()> {
        platform::replace_existing(prepared, destination)
    }

    fn commit_backup(&mut self, prepared: &Path, destination: &Path) -> io::Result<()> {
        platform::install_or_replace(prepared, destination)
    }
}

struct NoopObserver;

impl SaveObserver for NoopObserver {}

#[cfg(test)]
mod tests {
    use std::{
        fs, io,
        path::{Path, PathBuf},
    };

    #[cfg(unix)]
    use std::io::Write;

    #[cfg(any(unix, windows))]
    use kdbx::KdbxDocument;
    #[cfg(unix)]
    use kdbx::KdbxError;
    use vault_core::{EntryId, GroupId, NewEntry, SecretString};

    use super::{
        BACKUP_TEMP_PREFIX, SAVE_TEMP_PREFIX, SaveOutcome, SessionError, VaultSession, backup_path,
    };
    #[cfg(unix)]
    use super::{SaveObserver, SavePhase};

    const FIXTURE_PASSWORD: &str = "demopass";
    const KDBX41_FIXTURE: &str = "keepassxc-2.7.12-kdbx41.kdbx";
    #[cfg(unix)]
    const KDBX40_FIXTURE: &str = "keepassxc-upstream-kdbx40-argon2d-aes.kdbx";
    #[cfg(unix)]
    const KDBX31_FIXTURE: &str = "keepass-upstream-kdbx31-aeskdf-aes.kdbx";

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn create() -> Self {
            let parent = std::env::temp_dir();
            for _ in 0..128 {
                let name = super::random_temp_name("nian-pass-session-test-")
                    .expect("test randomness should be available");
                let path = parent.join(name);
                match fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("could not create isolated test directory: {error}"),
                }
            }
            panic!("could not allocate an isolated test directory");
        }

        fn fixture_copy(&self, fixture: &str, name: &str) -> PathBuf {
            let destination = self.path.join(name);
            fs::copy(fixture_path(fixture), &destination).expect("fixture copy should succeed");
            destination
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[cfg(unix)]
    struct HookObserver<F> {
        hook: F,
    }

    #[cfg(unix)]
    impl<F> SaveObserver for HookObserver<F>
    where
        F: for<'a> FnMut(SavePhase, &'a Path) -> Result<(), SessionError>,
    {
        fn checkpoint(&mut self, phase: SavePhase, path: &Path) -> Result<(), SessionError> {
            (self.hook)(phase, path)
        }
    }

    #[cfg(unix)]
    struct SerializationFailObserver;

    #[cfg(unix)]
    impl SaveObserver for SerializationFailObserver {
        fn serialize(
            &mut self,
            _document: &KdbxDocument,
            _destination: &mut impl Write,
            _credential: &SecretString,
        ) -> Result<(), SessionError> {
            Err(SessionError::Kdbx(KdbxError::WriteIo(io::Error::other(
                "injected serialization failure",
            ))))
        }
    }

    #[cfg(unix)]
    struct FinalDirectorySyncFailObserver;

    #[cfg(unix)]
    impl SaveObserver for FinalDirectorySyncFailObserver {
        fn sync_parent(&mut self, parent: &Path, after_target_replace: bool) -> io::Result<()> {
            if after_target_replace {
                Err(io::Error::other("injected final directory sync failure"))
            } else {
                super::platform::sync_parent(parent)
            }
        }
    }

    #[cfg(unix)]
    struct PrimaryReplaceFailObserver;

    #[cfg(unix)]
    impl SaveObserver for PrimaryReplaceFailObserver {
        fn replace_primary(&mut self, _prepared: &Path, _destination: &Path) -> io::Result<()> {
            Err(io::Error::other("injected primary replacement failure"))
        }
    }

    #[cfg(unix)]
    struct BackupCommitFailObserver;

    #[cfg(unix)]
    impl SaveObserver for BackupCommitFailObserver {
        fn commit_backup(&mut self, _prepared: &Path, _destination: &Path) -> io::Result<()> {
            Err(io::Error::other("injected backup commit failure"))
        }
    }

    fn fixture_path(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/kdbx")
            .join(name)
    }

    fn credential() -> SecretString {
        SecretString::new(FIXTURE_PASSWORD.to_owned())
    }

    fn first_entry(session: &VaultSession) -> EntryId {
        session
            .projection()
            .expect("fixture should project")
            .root()
            .entries()
            .first()
            .expect("fixture should have a root entry")
            .id()
            .clone()
    }

    fn root_group(session: &VaultSession) -> GroupId {
        session
            .projection()
            .expect("fixture should project")
            .root()
            .id()
            .clone()
    }

    fn dirty_session(path: &Path, title: &str) -> VaultSession {
        let mut session = VaultSession::open(path, &credential()).expect("fixture should open");
        let entry = first_entry(&session);
        session
            .document_mut()
            .set_entry_title(&entry, title)
            .expect("title mutation should succeed");
        assert!(session.is_dirty());
        session
    }

    #[cfg(unix)]
    fn save_document_to_path(document: &KdbxDocument, path: &Path) {
        let mut output = Vec::new();
        document
            .save_to_writer(&mut output, FIXTURE_PASSWORD)
            .expect("test document should serialize");
        fs::write(path, output).expect("test output should be written");
    }

    #[cfg(unix)]
    fn external_valid_version(path: &Path, title: &str) {
        let mut document =
            KdbxDocument::open(path, FIXTURE_PASSWORD).expect("source should open for test edit");
        let entry = document
            .projection()
            .expect("source should project")
            .root()
            .entries()
            .first()
            .expect("source should contain an entry")
            .id()
            .clone();
        document
            .set_entry_title(&entry, title)
            .expect("external test edit should succeed");
        save_document_to_path(&document, path);
    }

    fn assert_no_transaction_temps(directory: &Path) {
        for entry in fs::read_dir(directory).expect("test directory should be readable") {
            let name = entry
                .expect("directory entry should be readable")
                .file_name()
                .to_string_lossy()
                .into_owned();
            assert!(
                !name.starts_with(SAVE_TEMP_PREFIX) && !name.starts_with(BACKUP_TEMP_PREFIX),
                "transaction temp was not cleaned"
            );
        }
    }

    #[test]
    fn stable_open_owns_canonical_path_and_clean_save_is_a_true_noop() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let before = fs::read(&path).expect("source should be readable");
        let modified = fs::metadata(&path)
            .expect("source metadata should exist")
            .modified()
            .expect("source modified time should exist");

        let mut session = VaultSession::open(&path, &credential()).expect("session should open");
        assert!(session.path().is_absolute());
        assert!(!session.is_dirty());
        assert!(matches!(
            session.save(&credential()),
            Ok(SaveOutcome::Unchanged)
        ));
        assert_eq!(
            fs::read(&path).expect("source should remain readable"),
            before
        );
        assert_eq!(
            fs::metadata(&path)
                .expect("source metadata should remain")
                .modified()
                .expect("source modified time should remain"),
            modified
        );
        assert!(!backup_path(&path).exists());
        assert_no_transaction_temps(&directory.path);
        session.lock();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_source_is_rejected_without_following_it() {
        use std::os::unix::fs::symlink;

        let directory = TestDir::create();
        let source = directory.fixture_copy(KDBX41_FIXTURE, "source.kdbx");
        let link = directory.path.join("link.kdbx");
        symlink(&source, &link).expect("test symlink should be created");

        assert!(matches!(
            VaultSession::open(&link, &credential()),
            Err(SessionError::UnsupportedPath)
        ));
    }

    #[test]
    fn dirty_state_tracks_real_noop_create_and_delete_mutations() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let mut session = VaultSession::open(&path, &credential()).expect("session should open");
        let entry = first_entry(&session);
        let current_title = session
            .projection()
            .expect("fixture should project")
            .root()
            .entries()[0]
            .title()
            .visible()
            .expect("fixture title should be visible")
            .to_owned();
        session
            .document_mut()
            .set_entry_title(&entry, &current_title)
            .expect("same title should succeed");
        session
            .document_mut()
            .delete_entry_custom_field(&entry, "missing-field")
            .expect("missing custom field delete should succeed");
        assert!(!session.is_dirty());

        let root = root_group(&session);
        let created = session
            .document_mut()
            .create_entry(
                &root,
                NewEntry {
                    title: "created in session",
                    username: "",
                    url: "",
                    password: None,
                },
            )
            .expect("entry creation should succeed");
        assert!(session.is_dirty());
        session
            .document_mut()
            .permanently_delete_entry(&created)
            .expect("entry deletion should succeed");
        assert!(session.is_dirty());
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn verified_saves_rotate_exact_previous_ciphertext_and_update_baseline() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let source_a = fs::read(&path).expect("source A should be readable");
        let mut session = dirty_session(&path, "safe save B");

        assert!(matches!(
            session.save(&credential()),
            Ok(SaveOutcome::Saved)
        ));
        assert!(!session.is_dirty());
        let source_b = fs::read(&path).expect("source B should be readable");
        assert!(source_a != source_b);
        assert_eq!(
            fs::read(backup_path(&path)).expect("backup A should exist"),
            source_a
        );
        let reopened_b =
            KdbxDocument::open(&path, FIXTURE_PASSWORD).expect("saved B should reopen");
        session
            .document()
            .verify_semantic_equivalence(&reopened_b)
            .expect("saved B should equal the in-memory document");

        let entry = first_entry(&session);
        session
            .document_mut()
            .set_entry_title(&entry, "safe save C")
            .expect("second mutation should succeed");
        assert!(session.is_dirty());
        assert!(matches!(
            session.save(&credential()),
            Ok(SaveOutcome::Saved)
        ));
        assert!(!session.is_dirty());
        let source_c = fs::read(&path).expect("source C should be readable");
        assert!(source_b != source_c);
        assert_eq!(
            fs::read(backup_path(&path)).expect("backup B should exist"),
            source_b
        );
        let reopened_c =
            KdbxDocument::open(&path, FIXTURE_PASSWORD).expect("saved C should reopen");
        session
            .document()
            .verify_semantic_equivalence(&reopened_c)
            .expect("saved C should equal the in-memory document");
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(unix)]
    #[test]
    fn failed_second_save_does_not_advance_existing_backup() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let source_a = fs::read(&path).expect("source A should be readable");
        let mut session = dirty_session(&path, "successful B");
        session.save(&credential()).expect("B save should succeed");
        let source_b = fs::read(&path).expect("source B should be readable");
        assert_eq!(
            fs::read(backup_path(&path)).expect("backup A should exist"),
            source_a
        );

        let entry = first_entry(&session);
        session
            .document_mut()
            .set_entry_title(&entry, "failed C")
            .expect("C mutation should succeed");
        let saved_revision = session.saved_revision;
        let mut observer = HookObserver {
            hook: |phase, _: &Path| {
                if phase == SavePhase::BeforeTargetReplace {
                    Err(SessionError::InjectedFailure)
                } else {
                    Ok(())
                }
            },
        };

        assert!(matches!(
            session.save_with_observer(&credential(), &mut observer),
            Err(SessionError::InjectedFailure)
        ));
        assert_eq!(fs::read(&path).expect("primary B should remain"), source_b);
        assert_eq!(
            fs::read(backup_path(&path)).expect("backup A should remain"),
            source_a
        );
        assert!(session.is_dirty());
        assert_eq!(session.saved_revision, saved_revision);
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(unix)]
    #[test]
    fn primary_replace_failure_does_not_advance_existing_backup() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let source_a = fs::read(&path).expect("source A should be readable");
        let mut session = dirty_session(&path, "successful B");
        session.save(&credential()).expect("B save should succeed");
        let source_b = fs::read(&path).expect("source B should be readable");

        let entry = first_entry(&session);
        session
            .document_mut()
            .set_entry_title(&entry, "replacement-failed C")
            .expect("C mutation should succeed");
        assert!(matches!(
            session.save_with_observer(&credential(), &mut PrimaryReplaceFailObserver),
            Err(SessionError::AtomicReplaceFailed(_))
        ));
        assert_eq!(fs::read(&path).expect("primary B should remain"), source_b);
        assert_eq!(
            fs::read(backup_path(&path)).expect("backup A should remain"),
            source_a
        );
        assert!(session.is_dirty());
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(unix)]
    #[test]
    fn backup_commit_failure_after_save_keeps_old_backup_and_reconciles_primary() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let source_a = fs::read(&path).expect("source A should be readable");
        let mut session = dirty_session(&path, "successful B");
        session.save(&credential()).expect("B save should succeed");

        let entry = first_entry(&session);
        session
            .document_mut()
            .set_entry_title(&entry, "saved C without backup advance")
            .expect("C mutation should succeed");
        assert!(matches!(
            session.save_with_observer(&credential(), &mut BackupCommitFailObserver),
            Err(SessionError::SavedButBackupUpdateFailed(_))
        ));

        let source_c = fs::read(&path).expect("primary C should be readable");
        let reopened_c =
            KdbxDocument::open(&path, FIXTURE_PASSWORD).expect("primary C should reopen");
        session
            .document()
            .verify_semantic_equivalence(&reopened_c)
            .expect("primary C should equal memory");
        assert!(
            super::fingerprint_path(&path).expect("primary C should fingerprint")
                == session.source_fingerprint
        );
        assert_eq!(session.saved_revision, session.document().revision());
        assert!(!session.is_dirty());
        assert_eq!(
            fs::read(backup_path(&path)).expect("backup A should remain"),
            source_a
        );
        assert!(source_c != source_a);
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(unix)]
    #[test]
    fn final_generation_race_never_accepts_unverified_external_baseline() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let external_path = directory.fixture_copy(KDBX41_FIXTURE, "external.kdbx");
        external_valid_version(&external_path, "external C");
        let external_c = fs::read(&external_path).expect("external C should be readable");
        let mut session = dirty_session(&path, "Nian B");
        let target = path.clone();
        let replacement = external_path.clone();
        let mut observer = HookObserver {
            hook: move |phase, _: &Path| {
                if phase == SavePhase::AfterFinalDocumentRead {
                    fs::rename(&replacement, &target)
                        .expect("external final replacement should succeed");
                }
                Ok(())
            },
        };

        assert!(matches!(
            session.save_with_observer(&credential(), &mut observer),
            Err(SessionError::FinalExternalModificationDetected)
        ));
        assert_eq!(
            fs::read(&path).expect("external C should remain"),
            external_c
        );
        assert!(session.is_dirty());
        assert!(matches!(
            session.save(&credential()),
            Err(SessionError::ExternalModificationDetected)
        ));
        assert_eq!(
            fs::read(&path).expect("external C should still remain"),
            external_c
        );
        assert!(!backup_path(&path).exists());
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn wrong_save_credential_cannot_rekey_or_advance_backup() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let before = fs::read(&path).expect("source should be readable");
        let mut session = dirty_session(&path, "must not save");
        let saved_revision = session.saved_revision;
        let wrong = SecretString::new("wrong-public-test-password".to_owned());

        assert!(matches!(
            session.save(&wrong),
            Err(SessionError::CredentialMismatch)
        ));
        assert_eq!(
            fs::read(&path).expect("source should remain readable"),
            before
        );
        assert!(!backup_path(&path).exists());
        assert!(session.is_dirty());
        assert_eq!(session.saved_revision, saved_revision);
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(unix)]
    #[test]
    fn external_change_before_save_is_never_overwritten() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let mut session = dirty_session(&path, "stale local edit");
        external_valid_version(&path, "external edit B");
        let external = fs::read(&path).expect("external B should be readable");

        assert!(matches!(
            session.save(&credential()),
            Err(SessionError::ExternalModificationDetected)
        ));
        assert_eq!(fs::read(&path).expect("external B should remain"), external);
        assert!(session.is_dirty());
        assert!(!backup_path(&path).exists());
    }

    #[cfg(unix)]
    #[test]
    fn same_size_external_byte_change_is_detected_by_sha256() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let mut session = dirty_session(&path, "stale local edit");
        let mut external = fs::read(&path).expect("source should be readable");
        let index = external.len() - 1;
        external[index] ^= 0x01;
        fs::write(&path, &external).expect("same-size external edit should be written");

        assert!(matches!(
            session.save(&credential()),
            Err(SessionError::ExternalModificationDetected)
        ));
        assert_eq!(
            fs::read(&path).expect("external bytes should remain"),
            external
        );
        assert!(session.is_dirty());
    }

    #[cfg(unix)]
    #[test]
    fn external_change_after_temp_verification_is_caught_by_second_check() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let external_path = directory.fixture_copy(KDBX41_FIXTURE, "external.kdbx");
        external_valid_version(&external_path, "external race edit");
        let external = fs::read(&external_path).expect("external version should be readable");
        let mut session = dirty_session(&path, "stale local edit");
        let target = path.clone();
        let replacement = external_path.clone();
        let mut observer = HookObserver {
            hook: move |phase, _: &Path| {
                if phase == SavePhase::AfterTempVerify {
                    fs::rename(&replacement, &target).expect("external replacement should succeed");
                }
                Ok(())
            },
        };

        assert!(matches!(
            session.save_with_observer(&credential(), &mut observer),
            Err(SessionError::ExternalModificationDetected)
        ));
        assert_eq!(
            fs::read(&path).expect("external target should remain"),
            external
        );
        assert!(session.is_dirty());
        assert!(!backup_path(&path).exists());
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(unix)]
    #[test]
    fn serialization_and_temp_verification_failures_preserve_exact_source() {
        let directory = TestDir::create();

        let serialization_path = directory.fixture_copy(KDBX41_FIXTURE, "serialize.kdbx");
        let before = fs::read(&serialization_path).expect("source should be readable");
        let mut session = dirty_session(&serialization_path, "serialize failure edit");
        assert!(matches!(
            session.save_with_observer(&credential(), &mut SerializationFailObserver),
            Err(SessionError::Kdbx(KdbxError::WriteIo(_)))
        ));
        assert_eq!(
            fs::read(&serialization_path).expect("source should remain readable"),
            before
        );
        assert!(session.is_dirty());

        let verify_path = directory.fixture_copy(KDBX41_FIXTURE, "verify.kdbx");
        let before = fs::read(&verify_path).expect("source should be readable");
        let mut session = dirty_session(&verify_path, "verification failure edit");
        let mut observer = HookObserver {
            hook: |phase, temp: &Path| {
                if phase == SavePhase::AfterTempSync {
                    fs::write(temp, b"intentionally invalid KDBX")
                        .expect("temp corruption should succeed");
                }
                Ok(())
            },
        };
        assert!(matches!(
            session.save_with_observer(&credential(), &mut observer),
            Err(SessionError::TempVerificationFailed(_))
        ));
        assert_eq!(
            fs::read(&verify_path).expect("source should remain readable"),
            before
        );
        assert!(session.is_dirty());
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(unix)]
    #[test]
    fn backup_failure_aborts_before_source_replacement() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let before = fs::read(&path).expect("source should be readable");
        fs::create_dir(backup_path(&path)).expect("blocking backup directory should be created");
        let mut session = dirty_session(&path, "backup must fail");

        assert!(matches!(
            session.save(&credential()),
            Err(SessionError::BackupFailed(_))
        ));
        assert_eq!(
            fs::read(&path).expect("source should remain readable"),
            before
        );
        assert!(session.is_dirty());
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(unix)]
    #[test]
    fn corrupt_backup_temp_is_rejected_before_source_replacement() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let before = fs::read(&path).expect("source should be readable");
        let mut session = dirty_session(&path, "backup verification must fail");
        let mut observer = HookObserver {
            hook: |phase, temp: &Path| {
                if phase == SavePhase::AfterBackupWrite {
                    fs::write(temp, b"corrupt backup temp")
                        .expect("backup temp corruption should succeed");
                }
                Ok(())
            },
        };

        assert!(matches!(
            session.save_with_observer(&credential(), &mut observer),
            Err(SessionError::BackupVerificationFailed)
        ));
        assert_eq!(
            fs::read(&path).expect("source should remain readable"),
            before
        );
        assert!(!backup_path(&path).exists());
        assert!(session.is_dirty());
        assert_no_transaction_temps(&directory.path);
    }

    #[cfg(unix)]
    #[test]
    fn every_injected_pre_replace_failure_preserves_source_and_dirty_revision() {
        let phases = [
            SavePhase::AfterTempCreate,
            SavePhase::AfterSerialize,
            SavePhase::AfterTempSync,
            SavePhase::AfterTempVerify,
            SavePhase::AfterFinalExternalCheck,
            SavePhase::AfterBackupWrite,
            SavePhase::BeforeTargetReplace,
        ];

        for (index, failure_phase) in phases.into_iter().enumerate() {
            let directory = TestDir::create();
            let path = directory.fixture_copy(KDBX41_FIXTURE, &format!("vault-{index}.kdbx"));
            let before = fs::read(&path).expect("source should be readable");
            let mut session = dirty_session(&path, &format!("failure phase {index}"));
            let saved_revision = session.saved_revision;
            let mut observer = HookObserver {
                hook: move |phase, _: &Path| {
                    if phase == failure_phase {
                        Err(SessionError::InjectedFailure)
                    } else {
                        Ok(())
                    }
                },
            };

            assert!(matches!(
                session.save_with_observer(&credential(), &mut observer),
                Err(SessionError::InjectedFailure)
            ));
            assert_eq!(
                fs::read(&path).expect("source should remain readable"),
                before
            );
            assert!(session.is_dirty());
            assert_eq!(session.saved_revision, saved_revision);
            if backup_path(&path).exists() {
                assert_eq!(
                    fs::read(backup_path(&path)).expect("committed backup should be readable"),
                    before
                );
            }
            assert_no_transaction_temps(&directory.path);
        }
    }

    #[cfg(unix)]
    #[test]
    fn post_replace_fault_still_reconciles_session_with_verified_final_target() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let before = fs::read(&path).expect("source should be readable");
        let mut session = dirty_session(&path, "post replace edit");
        let mut observer = HookObserver {
            hook: |phase, _: &Path| {
                if phase == SavePhase::AfterTargetReplace {
                    Err(SessionError::InjectedFailure)
                } else {
                    Ok(())
                }
            },
        };

        assert!(matches!(
            session.save_with_observer(&credential(), &mut observer),
            Err(SessionError::InjectedFailure)
        ));
        assert!(!session.is_dirty());
        assert!(fs::read(&path).expect("final source should be readable") != before);
        let reopened =
            KdbxDocument::open(&path, FIXTURE_PASSWORD).expect("final source should reopen");
        session
            .document()
            .verify_semantic_equivalence(&reopened)
            .expect("post-replace final target should be verified");
    }

    #[cfg(unix)]
    #[test]
    fn directory_sync_failure_reports_uncertainty_after_reconciling_final_target() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let before = fs::read(&path).expect("source should be readable");
        let mut session = dirty_session(&path, "durability uncertainty edit");

        assert!(matches!(
            session.save_with_observer(&credential(), &mut FinalDirectorySyncFailObserver),
            Err(SessionError::DurabilityUncertain(_))
        ));
        assert!(!session.is_dirty());
        assert!(fs::read(&path).expect("final source should be readable") != before);
        let reopened =
            KdbxDocument::open(&path, FIXTURE_PASSWORD).expect("final source should reopen");
        session
            .document()
            .verify_semantic_equivalence(&reopened)
            .expect("durability-uncertain final target should be semantically current");
        assert_eq!(
            fs::read(backup_path(&path)).expect("previous source backup should exist"),
            before
        );
    }

    #[cfg(unix)]
    #[test]
    fn dirty_kdbx31_and_kdbx40_sessions_reject_save_without_touching_source() {
        for fixture in [KDBX31_FIXTURE, KDBX40_FIXTURE] {
            let directory = TestDir::create();
            let path = directory.fixture_copy(fixture, "vault.kdbx");
            let before = fs::read(&path).expect("source should be readable");
            let mut session = dirty_session(&path, "unsupported format edit");

            assert!(matches!(
                session.save(&credential()),
                Err(SessionError::Kdbx(KdbxError::UnsupportedWriteFormat))
            ));
            assert_eq!(
                fs::read(&path).expect("source should remain readable"),
                before
            );
            assert!(session.is_dirty());
            assert!(!backup_path(&path).exists());
            assert_no_transaction_temps(&directory.path);
        }
    }

    #[cfg(unix)]
    #[test]
    fn transaction_temps_are_same_directory_and_mode_0600() {
        use std::os::unix::fs::PermissionsExt;

        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let mut session = dirty_session(&path, "permission test edit");
        let expected_parent = path
            .parent()
            .expect("target should have a parent")
            .to_owned();
        let mut inspected = false;
        let mut observer = HookObserver {
            hook: |phase, temp: &Path| {
                if phase == SavePhase::AfterTempCreate {
                    assert_eq!(temp.parent(), Some(expected_parent.as_path()));
                    assert_eq!(
                        fs::metadata(temp)
                            .expect("temp metadata should exist")
                            .permissions()
                            .mode()
                            & 0o777,
                        0o600
                    );
                    inspected = true;
                }
                Ok(())
            },
        };

        session
            .save_with_observer(&credential(), &mut observer)
            .expect("save should succeed");
        assert!(inspected);
        for persisted in [&path, &backup_path(&path)] {
            assert_eq!(
                fs::metadata(persisted)
                    .expect("persisted file metadata should exist")
                    .permissions()
                    .mode()
                    & 0o777
                    & !0o600,
                0,
                "persisted vault permissions were broader than owner read/write"
            );
        }
    }

    #[test]
    fn error_display_never_embeds_underlying_paths() {
        let sensitive_path = "/private/example/vault.kdbx";
        let error = SessionError::AtomicReplaceFailed(io::Error::other(sensitive_path));
        assert_eq!(
            error.to_string(),
            "could not atomically replace the vault file"
        );
        assert!(!error.to_string().contains(sensitive_path));

        let backup_error =
            SessionError::SavedButBackupUpdateFailed(io::Error::other(sensitive_path));
        assert_eq!(
            backup_error.to_string(),
            "the vault was saved but its previous-version backup was not updated"
        );
        assert!(!backup_error.to_string().contains(sensitive_path));

        let final_error = SessionError::FinalReadFailed(io::Error::other(sensitive_path));
        assert_eq!(
            final_error.to_string(),
            "the replaced vault file could not be read for verification"
        );
        assert!(!final_error.to_string().contains(sensitive_path));
    }

    #[cfg(windows)]
    #[test]
    fn windows_dirty_save_fails_closed_without_touching_primary_or_backup() {
        let directory = TestDir::create();
        let path = directory.fixture_copy(KDBX41_FIXTURE, "vault.kdbx");
        let before = fs::read(&path).expect("source should be readable");
        let mut session = dirty_session(&path, "unsupported Windows save");

        assert!(matches!(
            session.save(&credential()),
            Err(SessionError::UnsupportedPersistencePlatform)
        ));
        assert_eq!(fs::read(&path).expect("source should remain"), before);
        assert!(!backup_path(&path).exists());
        assert!(session.is_dirty());
        assert_no_transaction_temps(&directory.path);
    }
}
