use crate::SecretString;

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
    }
}
