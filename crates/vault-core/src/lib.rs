//! KDBX-independent domain types used by Nian Pass clients.
//!
//! M2.5 retains a deliberately secret-free presentation projection and adds
//! narrow request and metadata types for structural vault operations. Group
//! names, custom-field names, visible entry metadata, and identifiers remain
//! privacy-sensitive. `Vault`, `Group`, `EntrySummary`, `CustomFieldSummary`,
//! `SummaryText`, `GroupId`, `EntryId`, and `SecretString` do not implement
//! `Debug`, which prevents accidental dumps.

use zeroize::Zeroizing;

mod entry_mutation;

pub use entry_mutation::{EntryUpdate, NewEntry};

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

/// Protection state for a custom entry field.
#[derive(Clone, Copy, Eq, PartialEq)]
pub enum FieldProtection {
    /// The field is encrypted by the KDBX inner protected stream.
    Protected,
    /// The field is stored as ordinary XML inside the encrypted database.
    Unprotected,
}

/// Privacy-sensitive metadata for one custom field, without its value.
///
/// Ordering between summaries is unspecified because the underlying KDBX
/// representation used by the adapter is key-based and unordered. Values must
/// be requested explicitly from the adapter as [`SecretString`].
///
/// ```compile_fail
/// use vault_core::{CustomFieldSummary, FieldProtection};
/// let summary = CustomFieldSummary::new("private-name", FieldProtection::Protected);
/// let rendered = format!("{summary:?}");
/// ```
///
/// ```compile_fail
/// use vault_core::{CustomFieldSummary, FieldProtection};
/// let summary = CustomFieldSummary::new("private-name", FieldProtection::Protected);
/// let rendered = format!("{summary}");
/// ```
#[derive(Clone, Eq, PartialEq)]
pub struct CustomFieldSummary {
    name: String,
    protection: FieldProtection,
}

impl CustomFieldSummary {
    /// Creates custom-field metadata without carrying the field value.
    #[must_use]
    pub fn new(name: impl Into<String>, protection: FieldProtection) -> Self {
        Self {
            name: name.into(),
            protection,
        }
    }

    /// Returns the privacy-sensitive field name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns whether the KDBX value is protected or unprotected.
    #[must_use]
    pub const fn protection(&self) -> FieldProtection {
        self.protection
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

    /// Finds a group recursively by stable identifier.
    #[must_use]
    pub fn find_group(&self, id: &GroupId) -> Option<&Group> {
        self.root.find_group(id)
    }

    /// Finds an entry recursively by stable identifier.
    #[must_use]
    pub fn find_entry(&self, id: &EntryId) -> Option<&EntrySummary> {
        self.root.find_entry(id)
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

    /// Finds an entry recursively by identifier.
    #[must_use]
    pub fn find_entry(&self, id: &EntryId) -> Option<&EntrySummary> {
        self.entries
            .iter()
            .find(|entry| entry.id() == id)
            .or_else(|| self.groups.iter().find_map(|group| group.find_entry(id)))
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

/// A standard text field projected without materializing protected plaintext.
///
/// Missing fields, visible fields (including explicit empty strings), and
/// protected fields remain distinct. A protected value records only its state;
/// the underlying plaintext is deliberately absent from this type.
#[derive(Clone, Eq, PartialEq)]
pub enum SummaryText {
    /// The source field does not exist.
    Missing,
    /// The source field is unprotected and safe to include in the projection.
    Visible(String),
    /// The source field exists and is protected; its plaintext is not projected.
    Protected,
}

impl SummaryText {
    /// Returns visible text, preserving an explicitly empty visible string.
    #[must_use]
    pub fn visible(&self) -> Option<&str> {
        match self {
            Self::Visible(value) => Some(value),
            Self::Missing | Self::Protected => None,
        }
    }

    /// Returns whether the source field was missing.
    #[must_use]
    pub const fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }

    /// Returns whether the source field was protected.
    #[must_use]
    pub const fn is_protected(&self) -> bool {
        matches!(self, Self::Protected)
    }
}

/// A deliberately secret-free entry projection for list and navigation views.
///
/// Password and notes presence is represented by booleans; their plaintext is
/// never copied here. TOTP seeds, custom-field values, and attachments are also
/// excluded. Protected Title, UserName, and URL fields are represented only by
/// [`SummaryText::Protected`], without copying their plaintext. Visible standard
/// fields, tags, and the identifier remain privacy-sensitive metadata. This is
/// not a save model.
#[derive(Clone, Eq, PartialEq)]
pub struct EntrySummary {
    id: EntryId,
    title: SummaryText,
    username: SummaryText,
    url: SummaryText,
    tags: Vec<String>,
    has_password: bool,
    has_notes: bool,
}

impl EntrySummary {
    /// Creates a secret-free entry summary.
    #[must_use]
    pub fn new(
        id: EntryId,
        title: SummaryText,
        username: SummaryText,
        url: SummaryText,
        tags: Vec<String>,
        has_password: bool,
        has_notes: bool,
    ) -> Self {
        Self {
            id,
            title,
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
    pub const fn title(&self) -> &SummaryText {
        &self.title
    }

    /// Returns projected username metadata without protected plaintext.
    #[must_use]
    pub const fn username(&self) -> &SummaryText {
        &self.username
    }

    /// Returns projected URL metadata without protected plaintext.
    #[must_use]
    pub const fn url(&self) -> &SummaryText {
        &self.url
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
    use super::{
        CustomFieldSummary, EntryId, EntrySummary, FieldProtection, Group, GroupId, SecretString,
        SummaryText, Vault,
    };

    fn entry(id: &str, title: &str) -> EntrySummary {
        EntrySummary::new(
            EntryId::new(id),
            SummaryText::Visible(title.to_owned()),
            SummaryText::Missing,
            SummaryText::Missing,
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
        assert!(vault.find_group(&GroupId::new("personal")).is_some());
    }

    #[test]
    fn traverses_nested_entries_by_id() {
        let vault = sample_vault();

        assert!(
            vault
                .find_entry(&EntryId::new("old"))
                .is_some_and(|entry| entry.title().visible() == Some("Old account"))
        );
        assert!(vault.root().find_entry(&EntryId::new("github")).is_some());
        assert!(vault.find_entry(&EntryId::new("missing")).is_none());
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
            SummaryText::Visible("Example".to_owned()),
            SummaryText::Visible("person@example.test".to_owned()),
            SummaryText::Visible("https://example.test".to_owned()),
            vec!["personal".to_owned()],
            true,
            true,
        );

        assert_eq!(entry.id().as_str(), "entry-id");
        assert!(entry.title().visible() == Some("Example"));
        assert!(entry.username().visible() == Some("person@example.test"));
        assert!(entry.url().visible() == Some("https://example.test"));
        assert!(entry.tags() == ["personal"]);
        assert!(entry.has_password());
        assert!(entry.has_notes());
    }

    #[test]
    fn summary_text_distinguishes_missing_visible_empty_and_protected() {
        let missing = SummaryText::Missing;
        let empty = SummaryText::Visible(String::new());
        let visible = SummaryText::Visible("public-metadata".to_owned());
        let protected = SummaryText::Protected;

        assert!(missing.is_missing());
        assert!(missing.visible().is_none());
        assert!(!empty.is_missing());
        assert!(empty.visible() == Some(""));
        assert!(visible.visible() == Some("public-metadata"));
        assert!(protected.is_protected());
        assert!(protected.visible().is_none());
    }

    #[test]
    fn secret_string_requires_explicit_plaintext_exposure() {
        let secret = SecretString::new("public-test-password".to_owned());

        assert!(
            secret.expose_secret() == "public-test-password",
            "synthetic secret was not retained"
        );
    }

    #[test]
    fn custom_field_summary_exposes_metadata_without_a_value() {
        let summary = CustomFieldSummary::new("synthetic-name", FieldProtection::Protected);

        assert!(summary.name() == "synthetic-name");
        assert!(summary.protection() == FieldProtection::Protected);
    }
}
