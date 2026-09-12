use serde::Serialize;
use vault_core::{CustomFieldSummary, EntrySummary, FieldProtection, Group, SummaryText, Vault};

#[cfg(desktop)]
use crate::clipboard::{ClipboardClearStatus, ClipboardCopy};

/// Filename metadata returned after a native file selection.
#[cfg(any(desktop, test))]
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedVaultDto {
    pub file_name: String,
}

/// Reviewed mobile source metadata. The opaque native handle stays in Rust.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSelectedVaultDto {
    pub file_name: String,
    pub writable: bool,
}

/// Platform-neutral, secret-free browse snapshot.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCoreSnapshotDto {
    pub dirty: bool,
    pub root_group_id: String,
    pub groups: Vec<GroupDto>,
    pub entries: Vec<EntrySummaryDto>,
}

/// Desktop browse snapshot sent to the WebView.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshotDto {
    pub dirty: bool,
    pub file_name: String,
    pub capabilities: VaultCapabilitiesDto,
    pub root_group_id: String,
    pub groups: Vec<GroupDto>,
    pub entries: Vec<EntrySummaryDto>,
}

/// Secret-free write capability metadata for the currently unlocked vault.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCapabilitiesDto {
    pub format_version: String,
    pub writable: bool,
    pub write_restriction: Option<WriteRestrictionDto>,
}

#[derive(Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteRestrictionDto {
    UnsupportedWriteFormat,
    UnsupportedPersistencePlatform,
    ReadOnlySource,
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
pub type MobileVaultSnapshotDto = VaultCoreSnapshotDto;

/// Secret-free result of entry creation.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedEntryDto<S = VaultSnapshotDto> {
    pub created_entry_id: String,
    pub snapshot: S,
}

/// Secret-free result of group creation.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedGroupDto<S = VaultSnapshotDto> {
    pub created_group_id: String,
    pub snapshot: S,
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
pub type MobileCreatedEntryDto = CreatedEntryDto<MobileVaultSnapshotDto>;
#[cfg(any(target_os = "android", target_os = "ios", test))]
pub type MobileCreatedGroupDto = CreatedGroupDto<MobileVaultSnapshotDto>;

/// Rust-authoritative decision for a main-window close request.
#[cfg(desktop)]
#[derive(Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "policy")]
pub enum ClosePolicyDto {
    Allow,
    ConfirmDiscard,
}

/// One group in the normalized browser tree.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDto {
    pub id: String,
    pub name: String,
    pub child_group_ids: Vec<String>,
    pub entry_ids: Vec<String>,
}

/// Non-secret entry metadata suitable for list rendering.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummaryDto {
    pub id: String,
    pub group_id: String,
    pub title: SummaryTextDto,
    pub username: SummaryTextDto,
    pub url: SummaryTextDto,
    pub password_present: bool,
    pub notes_present: bool,
    pub tags: Vec<String>,
}

/// Secret-free metadata for a selected entry.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryDetailDto {
    pub id: String,
    pub title: SummaryTextDto,
    pub username: SummaryTextDto,
    pub url: SummaryTextDto,
    pub password_present: bool,
    pub notes_present: bool,
    pub tags: Vec<String>,
    pub custom_fields: Vec<CustomFieldSummaryDto>,
}

/// A custom-field name and protection state, deliberately without its value.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomFieldSummaryDto {
    pub name: String,
    pub protection: FieldProtectionDto,
}

#[derive(Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldProtectionDto {
    Protected,
    Unprotected,
}

/// Safe confirmation that clipboard I/O succeeded.
#[cfg(desktop)]
#[derive(Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardReceiptDto {
    pub copied: bool,
    pub expires_in_ms: u64,
}

/// Lock always drops the session; this reports best-effort clipboard cleanup.
#[cfg(desktop)]
#[derive(Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "clipboard")]
pub enum LockResultDto {
    Cleared,
    NotOwned,
    ClearFailed,
}

/// Explicit projection that preserves missing, visible-empty, and protected.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum SummaryTextDto {
    Missing,
    Visible { value: String },
    Protected,
}

impl From<&SummaryText> for SummaryTextDto {
    fn from(value: &SummaryText) -> Self {
        match value {
            SummaryText::Missing => Self::Missing,
            SummaryText::Visible(value) => Self::Visible {
                value: value.clone(),
            },
            SummaryText::Protected => Self::Protected,
        }
    }
}

impl VaultSnapshotDto {
    #[must_use]
    pub fn from_vault(
        vault: &Vault,
        dirty: bool,
        file_name: String,
        capabilities: VaultCapabilitiesDto,
    ) -> Self {
        let core = VaultCoreSnapshotDto::from_vault(vault, dirty);

        Self {
            dirty: core.dirty,
            file_name,
            capabilities,
            root_group_id: core.root_group_id,
            groups: core.groups,
            entries: core.entries,
        }
    }
}

impl VaultCoreSnapshotDto {
    #[must_use]
    pub fn from_vault(vault: &Vault, dirty: bool) -> Self {
        let mut groups = Vec::with_capacity(vault.group_count());
        let mut entries = Vec::with_capacity(vault.entry_count());
        collect_group(vault.root(), &mut groups, &mut entries);

        Self {
            dirty,
            root_group_id: vault.root().id().as_str().to_owned(),
            groups,
            entries,
        }
    }
}

impl EntryDetailDto {
    #[must_use]
    pub fn from_entry(entry: &EntrySummary, custom_fields: &[CustomFieldSummary]) -> Self {
        Self {
            id: entry.id().as_str().to_owned(),
            title: entry.title().into(),
            username: entry.username().into(),
            url: entry.url().into(),
            password_present: entry.has_password(),
            notes_present: entry.has_notes(),
            tags: entry.tags().to_vec(),
            custom_fields: custom_fields.iter().map(Into::into).collect(),
        }
    }
}

impl From<&CustomFieldSummary> for CustomFieldSummaryDto {
    fn from(value: &CustomFieldSummary) -> Self {
        Self {
            name: value.name().to_owned(),
            protection: match value.protection() {
                FieldProtection::Protected => FieldProtectionDto::Protected,
                FieldProtection::Unprotected => FieldProtectionDto::Unprotected,
            },
        }
    }
}

#[cfg(desktop)]
impl From<ClipboardCopy> for ClipboardReceiptDto {
    fn from(value: ClipboardCopy) -> Self {
        Self {
            copied: true,
            expires_in_ms: value.expires_in_ms,
        }
    }
}

#[cfg(desktop)]
impl From<ClipboardClearStatus> for LockResultDto {
    fn from(value: ClipboardClearStatus) -> Self {
        match value {
            ClipboardClearStatus::Cleared => Self::Cleared,
            ClipboardClearStatus::NotOwned => Self::NotOwned,
            ClipboardClearStatus::ClearFailed => Self::ClearFailed,
        }
    }
}

fn collect_group(group: &Group, groups: &mut Vec<GroupDto>, entries: &mut Vec<EntrySummaryDto>) {
    let group_id = group.id().as_str().to_owned();
    groups.push(GroupDto {
        id: group_id.clone(),
        name: group.name().to_owned(),
        child_group_ids: group
            .groups()
            .iter()
            .map(|child| child.id().as_str().to_owned())
            .collect(),
        entry_ids: group
            .entries()
            .iter()
            .map(|entry| entry.id().as_str().to_owned())
            .collect(),
    });

    entries.extend(
        group
            .entries()
            .iter()
            .map(|entry| EntrySummaryDto::from_entry(entry, &group_id)),
    );

    for child in group.groups() {
        collect_group(child, groups, entries);
    }
}

impl EntrySummaryDto {
    fn from_entry(entry: &EntrySummary, group_id: &str) -> Self {
        Self {
            id: entry.id().as_str().to_owned(),
            group_id: group_id.to_owned(),
            title: entry.title().into(),
            username: entry.username().into(),
            url: entry.url().into(),
            password_present: entry.has_password(),
            notes_present: entry.has_notes(),
            tags: entry.tags().to_vec(),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, from_str, json, to_value};
    use vault_core::{CustomFieldSummary, EntryId, EntrySummary, FieldProtection, SummaryText};

    use super::{
        ClipboardReceiptDto, ClosePolicyDto, CreatedEntryDto, CreatedGroupDto, EntryDetailDto,
        EntrySummaryDto, GroupDto, LockResultDto, SelectedVaultDto, SummaryTextDto,
        VaultCapabilitiesDto, VaultSnapshotDto,
    };
    use crate::clipboard::{CLIPBOARD_CLEAR_MS, ClipboardClearStatus, ClipboardCopy};

    #[test]
    fn summary_text_mapping_preserves_all_security_states() {
        let cases = [
            (SummaryText::Missing, json!({ "kind": "missing" })),
            (
                SummaryText::Visible(String::new()),
                json!({ "kind": "visible", "value": "" }),
            ),
            (
                SummaryText::Visible("abc".to_owned()),
                json!({ "kind": "visible", "value": "abc" }),
            ),
            (SummaryText::Protected, json!({ "kind": "protected" })),
        ];

        for (source, expected) in cases {
            let dto = SummaryTextDto::from(&source);
            let serialized = to_value(dto).expect("summary DTO should serialize");
            assert_eq!(serialized, expected);
        }
    }

    #[test]
    fn committed_contract_fixture_matches_rust_serialization() {
        let contract: Value = from_str(include_str!("../../contracts/desktop-contract.json"))
            .expect("committed desktop contract should be valid JSON");
        let selected = SelectedVaultDto {
            file_name: "example.kdbx".to_owned(),
        };
        let snapshot = VaultSnapshotDto {
            dirty: false,
            file_name: "example.kdbx".to_owned(),
            capabilities: VaultCapabilitiesDto {
                format_version: "4.1".to_owned(),
                writable: true,
                write_restriction: None,
            },
            root_group_id: "group-root".to_owned(),
            groups: vec![GroupDto {
                id: "group-root".to_owned(),
                name: "Root".to_owned(),
                child_group_ids: Vec::new(),
                entry_ids: vec!["entry-example".to_owned()],
            }],
            entries: vec![EntrySummaryDto {
                id: "entry-example".to_owned(),
                group_id: "group-root".to_owned(),
                title: SummaryTextDto::Visible {
                    value: "Example".to_owned(),
                },
                username: SummaryTextDto::Missing,
                url: SummaryTextDto::Protected,
                password_present: true,
                notes_present: false,
                tags: vec!["test".to_owned()],
            }],
        };

        assert_eq!(
            contract["selectedVault"],
            to_value(selected).expect("selected vault DTO should serialize")
        );
        assert_eq!(
            contract["snapshot"],
            to_value(snapshot).expect("snapshot DTO should serialize")
        );
        let created_entry_snapshot = VaultSnapshotDto {
            dirty: true,
            file_name: "example.kdbx".to_owned(),
            capabilities: VaultCapabilitiesDto {
                format_version: "4.1".to_owned(),
                writable: true,
                write_restriction: None,
            },
            root_group_id: "group-root".to_owned(),
            groups: vec![GroupDto {
                id: "group-root".to_owned(),
                name: "Root".to_owned(),
                child_group_ids: Vec::new(),
                entry_ids: vec!["entry-created".to_owned()],
            }],
            entries: vec![EntrySummaryDto {
                id: "entry-created".to_owned(),
                group_id: "group-root".to_owned(),
                title: SummaryTextDto::Visible {
                    value: "Created".to_owned(),
                },
                username: SummaryTextDto::Missing,
                url: SummaryTextDto::Missing,
                password_present: false,
                notes_present: false,
                tags: Vec::new(),
            }],
        };
        assert_eq!(
            contract["createdEntry"],
            to_value(CreatedEntryDto {
                created_entry_id: "entry-created".to_owned(),
                snapshot: created_entry_snapshot,
            })
            .expect("created entry DTO should serialize")
        );
        let created_group_snapshot = VaultSnapshotDto {
            dirty: true,
            file_name: "example.kdbx".to_owned(),
            capabilities: VaultCapabilitiesDto {
                format_version: "4.1".to_owned(),
                writable: true,
                write_restriction: None,
            },
            root_group_id: "group-root".to_owned(),
            groups: vec![
                GroupDto {
                    id: "group-root".to_owned(),
                    name: "Root".to_owned(),
                    child_group_ids: vec!["group-created".to_owned()],
                    entry_ids: Vec::new(),
                },
                GroupDto {
                    id: "group-created".to_owned(),
                    name: "Created".to_owned(),
                    child_group_ids: Vec::new(),
                    entry_ids: Vec::new(),
                },
            ],
            entries: Vec::new(),
        };
        assert_eq!(
            contract["createdGroup"],
            to_value(CreatedGroupDto {
                created_group_id: "group-created".to_owned(),
                snapshot: created_group_snapshot,
            })
            .expect("created group DTO should serialize")
        );
        assert_eq!(
            contract["closePolicies"],
            to_value([ClosePolicyDto::Allow, ClosePolicyDto::ConfirmDiscard])
                .expect("close policies should serialize")
        );

        let entry = EntrySummary::new(
            EntryId::new("entry-example"),
            SummaryText::Visible("Example".to_owned()),
            SummaryText::Protected,
            SummaryText::Missing,
            vec!["test".to_owned()],
            true,
            true,
        );
        let detail = EntryDetailDto::from_entry(
            &entry,
            &[
                CustomFieldSummary::new("Recovery hint", FieldProtection::Protected),
                CustomFieldSummary::new("Region", FieldProtection::Unprotected),
            ],
        );
        assert_eq!(
            contract["entryDetail"],
            to_value(detail).expect("entry detail should serialize")
        );
        assert_eq!(
            contract["clipboardReceipt"],
            to_value(ClipboardReceiptDto::from(ClipboardCopy {
                generation: 1,
                expires_in_ms: CLIPBOARD_CLEAR_MS,
            }))
            .expect("clipboard receipt should serialize")
        );
        let lock_results = [
            ClipboardClearStatus::Cleared,
            ClipboardClearStatus::NotOwned,
            ClipboardClearStatus::ClearFailed,
        ]
        .map(LockResultDto::from);
        assert_eq!(
            contract["lockResults"],
            to_value(lock_results).expect("lock results should serialize")
        );
    }

    #[test]
    fn entry_detail_serialization_has_only_secret_free_reviewed_keys() {
        let detail = EntryDetailDto::from_entry(
            &EntrySummary::new(
                EntryId::new("entry-id"),
                SummaryText::Visible("Title".to_owned()),
                SummaryText::Protected,
                SummaryText::Visible("https://example.test".to_owned()),
                Vec::new(),
                true,
                true,
            ),
            &[CustomFieldSummary::new(
                "Synthetic field name",
                FieldProtection::Protected,
            )],
        );
        let value = to_value(detail).expect("entry detail should serialize");
        let object = value.as_object().expect("entry detail should be an object");
        assert_eq!(
            object
                .keys()
                .map(String::as_str)
                .collect::<std::collections::BTreeSet<_>>(),
            [
                "customFields",
                "id",
                "notesPresent",
                "passwordPresent",
                "tags",
                "title",
                "url",
                "username",
            ]
            .into_iter()
            .collect()
        );
        let serialized = value.to_string();
        for forbidden in ["password\"", "notes\"", "secret", "value\":\"Synthetic"] {
            assert!(!serialized.contains(forbidden));
        }
    }
}
