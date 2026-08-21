use serde::Serialize;
use vault_core::{EntrySummary, Group, SummaryText, Vault};

/// Filename metadata returned after a native file selection.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedVaultDto {
    pub file_name: String,
}

/// Secret-free browse snapshot sent to the WebView.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshotDto {
    pub root_group_id: String,
    pub groups: Vec<GroupDto>,
    pub entries: Vec<EntrySummaryDto>,
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
    pub fn from_vault(vault: &Vault) -> Self {
        let mut groups = Vec::with_capacity(vault.group_count());
        let mut entries = Vec::with_capacity(vault.entry_count());
        collect_group(vault.root(), &mut groups, &mut entries);

        Self {
            root_group_id: vault.root().id().as_str().to_owned(),
            groups,
            entries,
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
    use serde_json::{json, to_value};
    use vault_core::SummaryText;

    use super::SummaryTextDto;

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
}
