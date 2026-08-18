//! KDBX-independent domain types used by Nian Pass clients.
//!
//! M2 retains a deliberately secret-free presentation projection and adds an
//! explicit secret-bearing value type. Group names, entry metadata, and identifiers
//! remain privacy-sensitive. `Vault`, `Group`, `EntrySummary`, `GroupId`, `EntryId`,
//! and `SecretString` do not implement `Debug`, which prevents accidental dumps.

use zeroize::Zeroizing;

/// An owned secret whose backing string is zeroized when dropped.
///
/// Plaintext access is deliberately explicit. This type does not implement
/// `Debug`, `Display`, `Clone`, serialization, or implicit string-borrowing
/// traits. Zeroization reduces accidental residual memory, but cannot guarantee
/// removal of copies made by the operating system, runtime, compiler, or
/// dependencies.
///
/// ```compile_fail
/// use vault_core::SecretString;
/// let secret = SecretString::new("public-test-password".to_owned());
/// let duplicate = secret.clone();
/// ```
///
/// ```compile_fail
/// use vault_core::SecretString;
/// let secret = SecretString::new("public-test-password".to_owned());
/// let rendered = format!("{secret}");
/// ```
///
/// ```compile_fail
/// use vault_core::SecretString;
/// let secret = SecretString::new("public-test-password".to_owned());
/// let rendered = format!("{secret:?}");
/// ```
///
/// ```compile_fail
/// use vault_core::SecretString;
/// let secret = SecretString::new("public-test-password".to_owned());
/// let implicit: &str = &secret;
/// ```
pub struct SecretString {
    inner: Zeroizing<String>,
}

impl SecretString {
    /// Takes ownership of a plaintext secret.
    #[must_use]
    pub fn new(value: String) -> Self {
        Self {
            inner: Zeroizing::new(value),
        }
    }

    /// Explicitly exposes the secret plaintext for the shortest practical use.
    #[must_use]
    pub fn expose_secret(&self) -> &str {
        self.inner.as_str()
    }
}

/// A read-only view containing privacy-sensitive, non-secret vault metadata.
#[derive(Clone, Eq, PartialEq)]
pub struct Vault {
    root: Group,
}

impl Vault {
    /// Creates a vault from its root group.
    #[must_use]
    pub const fn new(root: Group) -> Self {
        Self { root }
    }

    /// Returns the root group.
    #[must_use]
    pub const fn root(&self) -> &Group {
        &self.root
    }

    /// Counts every group, including the root group.
    #[must_use]
    pub fn group_count(&self) -> usize {
        self.root.group_count()
    }

    /// Counts entries in the root group and all descendant groups.
    #[must_use]
    pub fn entry_count(&self) -> usize {
        self.root.entry_count()
    }
}

/// Stable group identifier copied across an adapter boundary.
#[derive(Clone, Eq, Hash, PartialEq)]
pub struct GroupId(String);

impl GroupId {
    /// Creates an identifier from its adapter-provided representation.
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Returns the identifier's string representation.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A vault group and its directly contained children.
#[derive(Clone, Eq, PartialEq)]
pub struct Group {
    id: GroupId,
    name: String,
    groups: Vec<Group>,
    entries: Vec<EntrySummary>,
}

impl Group {
    /// Creates a group.
    #[must_use]
    pub fn new(
        id: GroupId,
        name: impl Into<String>,
        groups: Vec<Group>,
        entries: Vec<EntrySummary>,
    ) -> Self {
        Self {
            id,
            name: name.into(),
            groups,
            entries,
        }
    }

    /// Returns the group identifier.
    #[must_use]
    pub const fn id(&self) -> &GroupId {
        &self.id
    }

    /// Returns the group name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns direct child groups.
    #[must_use]
    pub fn groups(&self) -> &[Group] {
        &self.groups
    }

    /// Returns direct child entries.
    #[must_use]
    pub fn entries(&self) -> &[EntrySummary] {
        &self.entries
    }

    /// Finds a group recursively by identifier, including this group.
    #[must_use]
    pub fn find_group(&self, id: &GroupId) -> Option<&Group> {
        if &self.id == id {
            return Some(self);
        }

        self.groups.iter().find_map(|group| group.find_group(id))
    }

    fn group_count(&self) -> usize {
        1 + self.groups.iter().map(Self::group_count).sum::<usize>()
    }

    fn entry_count(&self) -> usize {
        self.entries.len() + self.groups.iter().map(Self::entry_count).sum::<usize>()
    }
}

/// Stable entry identifier copied across an adapter boundary.
#[derive(Clone, Eq, Hash, PartialEq)]
pub struct EntryId(String);

impl EntryId {
    /// Creates an identifier from its adapter-provided representation.
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Returns the identifier's string representation.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A deliberately secret-free entry projection for list and navigation views.
///
/// Password and notes presence is represented by booleans; their plaintext is
/// never copied here. TOTP seeds, custom-field values, and attachments are also
/// excluded. Title, username, URL, tags, and the identifier remain
/// privacy-sensitive metadata. This is not a save model.
#[derive(Clone, Eq, PartialEq)]
pub struct EntrySummary {
    id: EntryId,
    title: String,
    username: Option<String>,
    url: Option<String>,
    tags: Vec<String>,
    has_password: bool,
    has_notes: bool,
}

impl EntrySummary {
    /// Creates a secret-free entry summary.
    #[must_use]
    pub fn new(
        id: EntryId,
        title: impl Into<String>,
        username: Option<String>,
        url: Option<String>,
        tags: Vec<String>,
        has_password: bool,
        has_notes: bool,
    ) -> Self {
        Self {
            id,
            title: title.into(),
            username,
            url,
            tags,
            has_password,
            has_notes,
        }
    }

    /// Returns the entry identifier.
    #[must_use]
    pub const fn id(&self) -> &EntryId {
        &self.id
    }

    /// Returns the entry title.
    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    /// Returns the username metadata, preserving absent versus explicit empty.
    #[must_use]
    pub fn username(&self) -> Option<&str> {
        self.username.as_deref()
    }

    /// Returns the URL metadata, preserving absent versus explicit empty.
    #[must_use]
    pub fn url(&self) -> Option<&str> {
        self.url.as_deref()
    }

    /// Returns the entry tags in their stored order.
    #[must_use]
    pub fn tags(&self) -> &[String] {
        &self.tags
    }

    /// Returns whether a Password field exists, without exposing its value.
    #[must_use]
    pub const fn has_password(&self) -> bool {
        self.has_password
    }

    /// Returns whether a Notes field exists, without exposing its value.
    #[must_use]
    pub const fn has_notes(&self) -> bool {
        self.has_notes
    }
}

#[cfg(test)]
mod tests {
    use super::{EntryId, EntrySummary, Group, GroupId, SecretString, Vault};

    fn entry(id: &str, title: &str) -> EntrySummary {
        EntrySummary::new(
            EntryId::new(id),
            title,
            None,
            None,
            Vec::new(),
            false,
            false,
        )
    }

    fn sample_vault() -> Vault {
        Vault::new(Group::new(
            GroupId::new("root"),
            "Root",
            vec![Group::new(
                GroupId::new("personal"),
                "Personal",
                vec![Group::new(
                    GroupId::new("archive"),
                    "Archive",
                    Vec::new(),
                    vec![entry("old", "Old account")],
                )],
                vec![entry("github", "GitHub"), entry("google", "Google")],
            )],
            Vec::new(),
        ))
    }

    #[test]
    fn traverses_nested_groups_by_id() {
        let vault = sample_vault();
        let archive = vault.root().find_group(&GroupId::new("archive"));

        assert!(archive.is_some_and(|group| group.name() == "Archive"));
        assert!(vault.root().find_group(&GroupId::new("missing")).is_none());
    }

    #[test]
    fn counts_groups_including_root() {
        assert_eq!(sample_vault().group_count(), 3);
    }

    #[test]
    fn counts_entries_recursively() {
        assert_eq!(sample_vault().entry_count(), 3);
    }

    #[test]
    fn entry_summary_exposes_metadata_and_presence_only() {
        let entry = EntrySummary::new(
            EntryId::new("entry-id"),
            "Example",
            Some("person@example.test".to_owned()),
            Some("https://example.test".to_owned()),
            vec!["personal".to_owned()],
            true,
            true,
        );

        assert_eq!(entry.id().as_str(), "entry-id");
        assert_eq!(entry.title(), "Example");
        assert_eq!(entry.username(), Some("person@example.test"));
        assert_eq!(entry.url(), Some("https://example.test"));
        assert!(entry.tags() == ["personal"]);
        assert!(entry.has_password());
        assert!(entry.has_notes());
    }

    #[test]
    fn secret_string_requires_explicit_plaintext_exposure() {
        let secret = SecretString::new("public-test-password".to_owned());

        assert!(
            secret.expose_secret() == "public-test-password",
            "synthetic secret was not retained"
        );
    }
}
