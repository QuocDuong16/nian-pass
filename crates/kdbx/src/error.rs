use thiserror::Error;

/// Errors returned while opening, projecting, mutating, or serializing KDBX.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum KdbxError {
    /// The database file could not be read.
    #[error("could not read the database file")]
    Io(#[source] std::io::Error),

    /// The input is truncated, malformed, or not a KDBX database.
    #[error("the file is not a valid KDBX database")]
    InvalidKdbx,

    /// The supplied database credentials were rejected.
    #[error("the master password is incorrect")]
    InvalidCredentials,

    /// The database uses a format or feature unsupported by this adapter.
    #[error("the KDBX format or feature is not supported")]
    UnsupportedFormat,

    /// A valid parsed database could not be represented by the domain model.
    #[error("the KDBX database could not be converted into the vault model: {0}")]
    Conversion(&'static str),

    /// Writing this exact KDBX version is not supported safely.
    #[error("writing this KDBX format is not supported")]
    UnsupportedWriteFormat,

    /// No entry matched the supplied stable identifier.
    #[error("entry was not found")]
    EntryNotFound,

    /// No group matched the supplied stable identifier.
    #[error("group was not found")]
    GroupNotFound,

    /// The root group cannot be permanently deleted.
    #[error("the root group cannot be permanently deleted")]
    CannotDeleteRootGroup,

    /// A group move targeted the root, itself, or one of its descendants.
    #[error("the group move is invalid")]
    InvalidGroupMove,

    /// A generic custom-field API targeted a reserved field name.
    #[error("the field name is reserved")]
    ReservedField,

    /// An attachment name was empty or otherwise invalid for this operation.
    #[error("the attachment name is invalid")]
    InvalidAttachmentName,

    /// No attachment matched the requested exact name.
    #[error("the attachment was not found")]
    AttachmentNotFound,

    /// Adding an attachment would implicitly replace an existing exact name.
    #[error("an attachment with that name already exists")]
    AttachmentAlreadyExists,

    /// Database metadata exceeded the reviewed bounds for this adapter.
    #[error("the database metadata is invalid")]
    InvalidDatabaseMetadata,

    /// An entry expiry timestamp could not be represented safely.
    #[error("the entry expiry timestamp is invalid")]
    InvalidExpiry,

    /// A requested built-in icon identifier is outside the standard KDBX set.
    #[error("the entry icon identifier is invalid")]
    InvalidIcon,

    /// Entry tags exceed reviewed count/size bounds or contain invalid duplicates.
    #[error("the entry tags are invalid")]
    InvalidEntryTags,

    /// No recognized TOTP configuration exists for the requested entry.
    #[error("the entry has no TOTP configuration")]
    TotpNotConfigured,

    /// The TOTP provisioning data is malformed or outside supported bounds.
    #[error("the entry TOTP configuration is invalid")]
    InvalidTotp,

    /// The entry uses a recognized TOTP storage layout that cannot be generated safely.
    #[error("the entry TOTP storage format is not supported")]
    UnsupportedTotpFormat,

    /// The requested entry history revision does not exist.
    #[error("the entry history revision was not found")]
    HistoryRevisionNotFound,

    /// The caller listed history before the document changed in memory.
    #[error("the entry history list is stale")]
    StaleHistory,

    /// Restoring this revision would require semantics the adapter cannot preserve safely.
    #[error("the entry history revision cannot be restored safely")]
    HistoryRestoreUnsupported,

    /// The requested history retention policy is outside reviewed bounds.
    #[error("the entry history retention policy is invalid")]
    InvalidHistoryPolicy,

    /// The database explicitly disables recycle-bin operations.
    #[error("the recycle bin is disabled for this database")]
    RecycleBinDisabled,

    /// A restore or permanent-delete operation targeted an object outside the recycle bin.
    #[error("the recycle-bin operation is invalid")]
    InvalidRecycleBinOperation,

    /// The caller-owned output writer rejected a write operation.
    #[error("could not write the KDBX output")]
    WriteIo(#[source] std::io::Error),

    /// The complete KDBX document could not be serialized.
    #[error("the KDBX database could not be serialized")]
    Serialization,

    /// Parsed KDBX state differs after a preservation-sensitive round trip.
    #[error("serialized vault did not preserve database semantics")]
    VerificationFailed,

    /// An internally synthesized sync candidate violated a required invariant.
    #[error("the parsed KDBX state could not be merged safely")]
    SyncInvariant,
}
