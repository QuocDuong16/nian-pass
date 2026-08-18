//! KDBX-independent domain types used by Nian Pass clients.
//!
//! M1 retains a deliberately credential-free presentation projection. Group names,
//! entry titles, and identifiers are not secret material, but they remain
//! privacy-sensitive. `Vault`, `Group`, `Entry`, `GroupId`, and `EntryId` do not
//! implement `Debug`, which prevents accidental bulk dumps. If secret fields
//! are added later, their types must redact debug output.

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
    entries: Vec<Entry>,
}

impl Group {
    /// Creates a group.
    #[must_use]
    pub fn new(
        id: GroupId,
        name: impl Into<String>,
        groups: Vec<Group>,
        entries: Vec<Entry>,
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
    pub fn entries(&self) -> &[Entry] {
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

/// A deliberately credential-free entry projection for M0.5.
///
/// Passwords, notes, TOTP seeds, custom fields, and attachments are not copied
/// into this type. This model is not a save model and must not be used to
/// reconstruct a KDBX database.
#[derive(Clone, Eq, PartialEq)]
pub struct Entry {
    id: EntryId,
    title: String,
}

impl Entry {
    /// Creates an entry projection.
    #[must_use]
    pub fn new(id: EntryId, title: impl Into<String>) -> Self {
        Self {
            id,
            title: title.into(),
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
}

#[cfg(test)]
mod tests {
    use super::{Entry, EntryId, Group, GroupId, Vault};

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
                    vec![Entry::new(EntryId::new("old"), "Old account")],
                )],
                vec![
                    Entry::new(EntryId::new("github"), "GitHub"),
                    Entry::new(EntryId::new("google"), "Google"),
                ],
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
    fn exposes_only_basic_entry_behavior() {
        let entry = Entry::new(EntryId::new("entry-id"), "Example");

        assert_eq!(entry.id().as_str(), "entry-id");
        assert_eq!(entry.title(), "Example");
    }
}
