use crate::{EntrySummary, SecretString};

/// Highest standard KDBX icon identifier defined by the KeePass icon set.
pub const MAX_STANDARD_ICON_ID: u8 = 68;

/// Secret-free icon metadata projected for one entry.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum EntryIconSummary {
    /// The entry has no explicit icon.
    None,
    /// One of the standard KDBX built-in icons.
    BuiltIn(u8),
    /// The entry references a custom icon stored in the database.
    Custom,
    /// The database contains a non-standard built-in icon identifier.
    NonStandard,
}

/// Requested icon state for one atomic entry update.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum EntryIconUpdate {
    /// Clear the explicit entry icon.
    None,
    /// Replace the current icon with one standard built-in icon.
    BuiltIn(u8),
}

/// Requested expiry state for one entry update.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum EntryExpiry {
    /// Disable expiry and clear the stored expiry timestamp.
    Disabled,
    /// Enable expiry at the supplied Unix timestamp in whole seconds.
    AtUnixSeconds(i64),
}

/// Requested TOTP state for one atomic entry update.
pub enum EntryTotpUpdate<'a> {
    /// Remove every recognized TOTP configuration field.
    Clear,
    /// Replace TOTP configuration with one validated provisioning URI.
    Set(&'a SecretString),
}

/// Input for creating one entry without exposing adapter-specific types.
///
/// Empty title, username, and URL values are omitted rather than materialized
/// as empty KDBX fields. `None` omits Password, while `Some` represents an
/// explicitly present password, including an explicitly empty one.
pub struct NewEntry<'a> {
    /// Entry title metadata.
    pub title: &'a str,
    /// Entry username metadata.
    pub username: &'a str,
    /// Entry URL metadata, stored without normalization.
    pub url: &'a str,
    /// Optional password, always protected when newly created.
    pub password: Option<&'a SecretString>,
}

/// Optional standard-field changes for one atomic entry update.
///
/// `None` leaves a field unchanged. `Some("")` explicitly sets an existing
/// field to empty while preserving the adapter's established missing-field
/// semantics. Secret-bearing values remain wrapped in [`SecretString`].
pub struct EntryUpdate<'a> {
    /// Replacement title, or `None` to leave it unchanged.
    pub title: Option<&'a str>,
    /// Replacement username, or `None` to leave it unchanged.
    pub username: Option<&'a str>,
    /// Replacement URL, or `None` to leave it unchanged.
    pub url: Option<&'a str>,
    /// Replacement password, or `None` to leave it unchanged.
    pub password: Option<&'a SecretString>,
    /// Replacement notes, or `None` to leave them unchanged.
    pub notes: Option<&'a SecretString>,
    /// Replacement expiry state, or `None` to leave it unchanged.
    pub expiry: Option<EntryExpiry>,
    /// Replacement TOTP state, or `None` to leave it unchanged.
    pub totp: Option<EntryTotpUpdate<'a>>,
    /// Replacement entry icon, or `None` to leave it unchanged.
    pub icon: Option<EntryIconUpdate>,
}

impl EntryUpdate<'_> {
    /// Returns whether the request leaves every standard field unchanged.
    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.username.is_none()
            && self.url.is_none()
            && self.password.is_none()
            && self.notes.is_none()
            && self.expiry.is_none()
            && self.totp.is_none()
            && self.icon.is_none()
    }
}

impl EntrySummary {
    /// Adds secret-free icon metadata to this summary.
    #[must_use]
    pub const fn with_icon(mut self, icon: EntryIconSummary) -> Self {
        self.icon = icon;
        self
    }

    /// Returns the secret-free icon metadata for this entry.
    #[must_use]
    pub const fn icon(&self) -> EntryIconSummary {
        self.icon
    }

    /// Adds recognized TOTP presence metadata without exposing its seed.
    #[must_use]
    pub const fn with_totp(mut self, has_totp: bool) -> Self {
        self.has_totp = has_totp;
        self
    }

    /// Adds enabled expiry metadata to this summary.
    #[must_use]
    pub const fn with_expiry(mut self, expires_at_unix_seconds: Option<i64>) -> Self {
        self.expires_at_unix_seconds = expires_at_unix_seconds;
        self
    }

    /// Returns the enabled expiry timestamp as Unix seconds, if present.
    #[must_use]
    pub const fn expires_at_unix_seconds(&self) -> Option<i64> {
        self.expires_at_unix_seconds
    }
}
