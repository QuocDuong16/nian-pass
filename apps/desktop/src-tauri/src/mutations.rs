mod bulk;
pub use bulk::{
    BulkDeleteEntriesRequestDto, BulkMoveEntriesRequestDto, BulkRestoreEntriesRequestDto,
    BulkTrashEntriesRequestDto,
};

use serde::Deserialize;
use vault_core::{
    EntryExpiry, EntryIconUpdate, EntryId, EntryTotpUpdate, EntryUpdate, FieldProtection, GroupId,
    MAX_STANDARD_ICON_ID, NewEntry, SecretString,
};

use crate::{
    dto::{CreatedEntryDto, CreatedGroupDto, VaultSnapshotDto},
    state::{DesktopError, DesktopVaultService, map_mutation_error},
};

#[derive(Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum EntryIconRequestDto {
    None,
    BuiltIn { id: u8 },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateEntryRequestDto {
    entry_id: String,
    title: Option<String>,
    username: Option<String>,
    url: Option<String>,
    password: Option<String>,
    notes: Option<String>,
    expires: Option<bool>,
    expiry_unix_seconds: Option<i64>,
    totp_enabled: Option<bool>,
    totp_uri: Option<String>,
    icon: Option<EntryIconRequestDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateEntryRequestDto {
    group_id: String,
    title: String,
    username: String,
    url: String,
    password: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveEntryRequestDto {
    entry_id: String,
    destination_group_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateGroupRequestDto {
    parent_group_id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameGroupRequestDto {
    group_id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveGroupRequestDto {
    group_id: String,
    destination_group_id: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldProtectionRequestDto {
    Protected,
    Unprotected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetCustomFieldRequestDto {
    entry_id: String,
    name: String,
    value: String,
    protection: FieldProtectionRequestDto,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetEntryTagsRequestDto {
    entry_id: String,
    tags: Vec<String>,
}

impl DesktopVaultService {
    pub fn update_entry(
        &mut self,
        request: UpdateEntryRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&request.entry_id)?;
        let password = request.password.map(SecretString::new);
        let notes = request.notes.map(SecretString::new);
        let expiry = expiry_from_request(request.expires, request.expiry_unix_seconds)?;
        let totp_uri = request.totp_uri.map(SecretString::new);
        let totp = totp_from_request(request.totp_enabled, totp_uri.as_ref())?;
        let icon = icon_from_request(request.icon)?;
        self.session_mut()?
            .update_entry(
                &EntryId::new(request.entry_id),
                EntryUpdate {
                    title: request.title.as_deref(),
                    username: request.username.as_deref(),
                    url: request.url.as_deref(),
                    password: password.as_ref(),
                    notes: notes.as_ref(),
                    expiry,
                    totp,
                    icon,
                },
            )
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn set_entry_tags(
        &mut self,
        request: SetEntryTagsRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&request.entry_id)?;
        self.session_mut()?
            .set_entry_tags(&EntryId::new(request.entry_id), &request.tags)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn create_entry(
        &mut self,
        request: CreateEntryRequestDto,
    ) -> Result<CreatedEntryDto, DesktopError> {
        require_id(&request.group_id)?;
        let password = request.password.map(SecretString::new);
        let notes = request.notes.map(SecretString::new);
        let created = self
            .session_mut()?
            .create_entry(
                &GroupId::new(request.group_id),
                NewEntry {
                    title: &request.title,
                    username: &request.username,
                    url: &request.url,
                    password: password.as_ref(),
                },
                notes.as_ref(),
            )
            .map_err(map_mutation_error)?;
        Ok(CreatedEntryDto {
            created_entry_id: created.as_str().to_owned(),
            snapshot: self.snapshot()?,
        })
    }

    pub fn duplicate_entry(&mut self, entry_id: String) -> Result<CreatedEntryDto, DesktopError> {
        require_id(&entry_id)?;
        let created = self
            .session_mut()?
            .duplicate_entry(&EntryId::new(entry_id))
            .map_err(map_mutation_error)?;
        Ok(CreatedEntryDto {
            created_entry_id: created.as_str().to_owned(),
            snapshot: self.snapshot()?,
        })
    }

    pub fn delete_entry(&mut self, entry_id: String) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&entry_id)?;
        self.session_mut()?
            .trash_entry(&EntryId::new(entry_id))
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn restore_entry(&mut self, entry_id: String) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&entry_id)?;
        self.session_mut()?
            .restore_entry(&EntryId::new(entry_id))
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn permanently_delete_entry(
        &mut self,
        entry_id: String,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&entry_id)?;
        self.session_mut()?
            .permanently_delete_recycled_entry(&EntryId::new(entry_id))
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn move_entry(
        &mut self,
        request: MoveEntryRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&request.entry_id)?;
        require_id(&request.destination_group_id)?;
        self.session_mut()?
            .move_entry(
                &EntryId::new(request.entry_id),
                &GroupId::new(request.destination_group_id),
            )
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn create_group(
        &mut self,
        request: CreateGroupRequestDto,
    ) -> Result<CreatedGroupDto, DesktopError> {
        require_id(&request.parent_group_id)?;
        require_name(&request.name)?;
        let created = self
            .session_mut()?
            .create_group(&GroupId::new(request.parent_group_id), &request.name)
            .map_err(map_mutation_error)?;
        Ok(CreatedGroupDto {
            created_group_id: created.as_str().to_owned(),
            snapshot: self.snapshot()?,
        })
    }

    pub fn rename_group(
        &mut self,
        request: RenameGroupRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&request.group_id)?;
        require_name(&request.name)?;
        self.session_mut()?
            .rename_group(&GroupId::new(request.group_id), &request.name)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn move_group(
        &mut self,
        request: MoveGroupRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&request.group_id)?;
        require_id(&request.destination_group_id)?;
        self.session_mut()?
            .move_group(
                &GroupId::new(request.group_id),
                &GroupId::new(request.destination_group_id),
            )
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn delete_group(&mut self, group_id: String) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&group_id)?;
        self.session_mut()?
            .trash_group(&GroupId::new(group_id))
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn restore_group(&mut self, group_id: String) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&group_id)?;
        self.session_mut()?
            .restore_group(&GroupId::new(group_id))
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn permanently_delete_group(
        &mut self,
        group_id: String,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&group_id)?;
        self.session_mut()?
            .permanently_delete_recycled_group(&GroupId::new(group_id))
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn set_custom_field(
        &mut self,
        request: SetCustomFieldRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&request.entry_id)?;
        let entry_id = EntryId::new(request.entry_id);
        let exists = self
            .session_mut()?
            .has_entry_custom_field(&entry_id, &request.name)
            .map_err(map_mutation_error)?;
        if !exists {
            require_name(&request.name)?;
        }
        let value = SecretString::new(request.value);
        let protection = match request.protection {
            FieldProtectionRequestDto::Protected => FieldProtection::Protected,
            FieldProtectionRequestDto::Unprotected => FieldProtection::Unprotected,
        };
        self.session_mut()?
            .set_entry_custom_field(&entry_id, &request.name, &value, protection)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn delete_custom_field(
        &mut self,
        entry_id: String,
        name: String,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        require_id(&entry_id)?;
        self.session_mut()?
            .delete_entry_custom_field(&EntryId::new(entry_id), &name)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }
}

fn totp_from_request<'a>(
    enabled: Option<bool>,
    uri: Option<&'a SecretString>,
) -> Result<Option<EntryTotpUpdate<'a>>, DesktopError> {
    match (enabled, uri) {
        (None, None) => Ok(None),
        (Some(false), None) => Ok(Some(EntryTotpUpdate::Clear)),
        (Some(true), Some(uri)) if !uri.expose_secret().trim().is_empty() => {
            Ok(Some(EntryTotpUpdate::Set(uri)))
        }
        _ => Err(DesktopError::InvalidRequest),
    }
}

fn icon_from_request(
    icon: Option<EntryIconRequestDto>,
) -> Result<Option<EntryIconUpdate>, DesktopError> {
    match icon {
        None => Ok(None),
        Some(EntryIconRequestDto::None) => Ok(Some(EntryIconUpdate::None)),
        Some(EntryIconRequestDto::BuiltIn { id }) if id <= MAX_STANDARD_ICON_ID => {
            Ok(Some(EntryIconUpdate::BuiltIn(id)))
        }
        Some(EntryIconRequestDto::BuiltIn { .. }) => Err(DesktopError::InvalidRequest),
    }
}

fn expiry_from_request(
    expires: Option<bool>,
    expiry_unix_seconds: Option<i64>,
) -> Result<Option<EntryExpiry>, DesktopError> {
    match (expires, expiry_unix_seconds) {
        (None, None) => Ok(None),
        (Some(false), None) => Ok(Some(EntryExpiry::Disabled)),
        (Some(true), Some(seconds)) => Ok(Some(EntryExpiry::AtUnixSeconds(seconds))),
        _ => Err(DesktopError::InvalidRequest),
    }
}

fn require_id(value: &str) -> Result<(), DesktopError> {
    if value.is_empty() {
        Err(DesktopError::InvalidRequest)
    } else {
        Ok(())
    }
}

fn require_name(value: &str) -> Result<(), DesktopError> {
    if value.trim().is_empty() {
        Err(DesktopError::InvalidRequest)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::Arc,
    };

    use serde_json::{from_value, json, to_string};
    use vault_core::{EntryId, FieldProtection, SecretString};

    use super::{
        CreateEntryRequestDto, CreateGroupRequestDto, EntryIconRequestDto,
        FieldProtectionRequestDto, MoveEntryRequestDto, MoveGroupRequestDto, RenameGroupRequestDto,
        SetCustomFieldRequestDto, SetEntryTagsRequestDto, UpdateEntryRequestDto,
    };
    use crate::{
        clipboard::ClipboardPort,
        state::{AppState, DesktopError, DesktopVaultService},
    };

    const PASSWORD: &str = "demopass";

    struct FailingClipboard;

    impl ClipboardPort for FailingClipboard {
        fn write_text(&self, _value: &str) -> Result<(), ()> {
            Err(())
        }

        fn read_text(&self) -> Result<Option<String>, ()> {
            Err(())
        }

        fn clear(&self) -> Result<(), ()> {
            Err(())
        }
    }

    fn fixture_path() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx")
    }

    fn unlocked_service() -> DesktopVaultService {
        let mut service = DesktopVaultService::new();
        service
            .select_path(fixture_path())
            .expect("fixture path should be selectable");
        service
            .unlock(SecretString::new(PASSWORD.to_owned()))
            .expect("fixture should unlock");
        service
    }

    #[test]
    fn semantic_mutations_refresh_dirty_secret_free_snapshots_without_writing_source() {
        let source_before = fs::read(fixture_path()).expect("fixture should be readable");
        let mut service = unlocked_service();
        let initial = service.snapshot().expect("snapshot should exist");
        let root = initial.root_group_id.clone();
        let destination = initial
            .groups
            .iter()
            .find(|group| group.id != root)
            .expect("fixture should contain a child group")
            .id
            .clone();
        let entry = initial.entries.first().expect("fixture entry").id.clone();
        let revision_before = service
            .session_mut()
            .expect("unlocked session")
            .document()
            .revision();

        let updated = service
            .update_entry(UpdateEntryRequestDto {
                entry_id: entry,
                title: Some("M4.3 updated title".to_owned()),
                username: Some("M4.3 updated user".to_owned()),
                url: Some("m4.3://updated".to_owned()),
                password: Some("M4.3-SECRET-PASSWORD".to_owned()),
                notes: Some("M4.3-SECRET-NOTES".to_owned()),
                expires: None,
                expiry_unix_seconds: None,
                totp_enabled: None,
                totp_uri: None,
                icon: None,
            })
            .expect("entry update should succeed");
        assert!(updated.dirty);
        assert_eq!(
            service
                .session_mut()
                .expect("unlocked session")
                .document()
                .revision(),
            revision_before + 1
        );

        let tagged = service
            .set_entry_tags(SetEntryTagsRequestDto {
                entry_id: updated.entries[0].id.clone(),
                tags: vec!["finance".to_owned(), "primary".to_owned()],
            })
            .expect("tag mutation should succeed");
        assert!(tagged.dirty);
        assert_eq!(
            service
                .entry_detail(&updated.entries[0].id)
                .expect("tagged detail")
                .tags,
            ["finance", "primary"]
        );
        assert!(matches!(
            service.set_entry_tags(SetEntryTagsRequestDto {
                entry_id: updated.entries[0].id.clone(),
                tags: vec![String::new()],
            }),
            Err(DesktopError::InvalidRequest)
        ));

        let created = service
            .create_entry(CreateEntryRequestDto {
                group_id: root.clone(),
                title: "Created in M4.3".to_owned(),
                username: "created-user".to_owned(),
                url: "m4.3://created".to_owned(),
                password: Some("M4.3-SECRET-PASSWORD".to_owned()),
                notes: Some("M4.3-SECRET-NOTES".to_owned()),
            })
            .expect("entry creation should succeed");
        let serialized = to_string(&created).expect("created result should serialize");
        assert!(!serialized.contains("M4.3-SECRET"));
        assert!(created.snapshot.dirty);
        assert!(
            created
                .snapshot
                .entries
                .iter()
                .any(|item| item.id == created.created_entry_id)
        );

        let duplicated = service
            .duplicate_entry(created.created_entry_id.clone())
            .expect("entry duplication should succeed");
        assert!(duplicated.created_entry_id != created.created_entry_id);
        assert!(duplicated.snapshot.dirty);
        let duplicated_json = to_string(&duplicated).expect("duplicate result should serialize");
        assert!(!duplicated_json.contains("M4.3-SECRET"));
        assert!(
            duplicated
                .snapshot
                .entries
                .iter()
                .any(|item| item.id == duplicated.created_entry_id)
        );

        let moved = service
            .move_entry(MoveEntryRequestDto {
                entry_id: created.created_entry_id.clone(),
                destination_group_id: destination.clone(),
            })
            .expect("entry move should succeed");
        assert!(
            moved.entries.iter().any(|item| {
                item.id == created.created_entry_id && item.group_id == destination
            })
        );

        service
            .set_custom_field(SetCustomFieldRequestDto {
                entry_id: created.created_entry_id.clone(),
                name: "M4.3 custom".to_owned(),
                value: "M4.3-SECRET-CUSTOM".to_owned(),
                protection: FieldProtectionRequestDto::Protected,
            })
            .expect("custom field should be added");
        let detail = service
            .entry_detail(&created.created_entry_id)
            .expect("created detail should exist");
        assert!(detail.custom_fields.iter().any(|field| {
            field.name == "M4.3 custom"
                && matches!(field.protection, crate::dto::FieldProtectionDto::Protected)
        }));
        service
            .set_custom_field(SetCustomFieldRequestDto {
                entry_id: created.created_entry_id.clone(),
                name: "M4.3 public custom".to_owned(),
                value: "M4.3-SECRET-PUBLIC-CUSTOM".to_owned(),
                protection: FieldProtectionRequestDto::Unprotected,
            })
            .expect("unprotected custom field should be added");
        let detail = service
            .entry_detail(&created.created_entry_id)
            .expect("created detail should exist");
        assert!(detail.custom_fields.iter().any(|field| {
            field.name == "M4.3 public custom"
                && matches!(
                    field.protection,
                    crate::dto::FieldProtectionDto::Unprotected
                )
        }));
        service
            .set_custom_field(SetCustomFieldRequestDto {
                entry_id: created.created_entry_id.clone(),
                name: "M4.3 custom".to_owned(),
                value: "M4.3-SECRET-CUSTOM-UPDATED".to_owned(),
                protection: FieldProtectionRequestDto::Unprotected,
            })
            .expect("custom field should update");
        let detail = service
            .entry_detail(&created.created_entry_id)
            .expect("updated detail should exist");
        assert!(detail.custom_fields.iter().any(|field| {
            field.name == "M4.3 custom"
                && matches!(field.protection, crate::dto::FieldProtectionDto::Protected)
        }));
        service
            .delete_custom_field(created.created_entry_id.clone(), "M4.3 custom".to_owned())
            .expect("custom field should delete");
        service
            .delete_custom_field(
                created.created_entry_id.clone(),
                "M4.3 public custom".to_owned(),
            )
            .expect("unprotected custom field should delete");

        let first_group = service
            .create_group(CreateGroupRequestDto {
                parent_group_id: root.clone(),
                name: "M4.3 group".to_owned(),
            })
            .expect("group should create");
        let second_group = service
            .create_group(CreateGroupRequestDto {
                parent_group_id: root.clone(),
                name: "M4.3 destination".to_owned(),
            })
            .expect("destination should create");
        service
            .rename_group(RenameGroupRequestDto {
                group_id: first_group.created_group_id.clone(),
                name: "M4.3 renamed".to_owned(),
            })
            .expect("group should rename");
        service
            .move_group(MoveGroupRequestDto {
                group_id: first_group.created_group_id.clone(),
                destination_group_id: second_group.created_group_id.clone(),
            })
            .expect("group should move");
        service
            .delete_entry(created.created_entry_id)
            .expect("entry should delete");
        let after_delete = service
            .delete_group(second_group.created_group_id)
            .expect("recursive group should delete");
        assert!(after_delete.dirty);
        assert_eq!(
            fs::read(fixture_path()).expect("fixture should remain readable"),
            source_before
        );
    }

    #[test]
    fn expiry_request_shape_is_validated_and_projects_safe_metadata() {
        let mut service = unlocked_service();
        let entry_id = service
            .snapshot()
            .expect("snapshot should exist")
            .entries
            .first()
            .expect("fixture entry")
            .id
            .clone();

        for (expires, expiry_unix_seconds) in [
            (Some(true), None),
            (Some(false), Some(2_000_000_000)),
            (None, Some(2_000_000_000)),
        ] {
            assert!(matches!(
                service.update_entry(UpdateEntryRequestDto {
                    entry_id: entry_id.clone(),
                    title: None,
                    username: None,
                    url: None,
                    password: None,
                    notes: None,
                    expires,
                    expiry_unix_seconds,
                    totp_enabled: None,
                    totp_uri: None,
                    icon: None,
                }),
                Err(DesktopError::InvalidRequest)
            ));
        }
        assert!(
            !service
                .snapshot()
                .expect("snapshot should remain clean")
                .dirty
        );

        let expiry = 2_000_000_000;
        let updated = service
            .update_entry(UpdateEntryRequestDto {
                entry_id: entry_id.clone(),
                title: None,
                username: None,
                url: None,
                password: None,
                notes: None,
                expires: Some(true),
                expiry_unix_seconds: Some(expiry),
                totp_enabled: None,
                totp_uri: None,
                icon: None,
            })
            .expect("valid expiry should update");
        assert_eq!(
            updated
                .entries
                .iter()
                .find(|entry| entry.id == entry_id)
                .and_then(|entry| entry.expires_at_unix_seconds),
            Some(expiry)
        );

        let disabled = service
            .update_entry(UpdateEntryRequestDto {
                entry_id: entry_id.clone(),
                title: None,
                username: None,
                url: None,
                password: None,
                notes: None,
                expires: Some(false),
                expiry_unix_seconds: None,
                totp_enabled: None,
                totp_uri: None,
                icon: None,
            })
            .expect("expiry should disable");
        assert_eq!(
            disabled
                .entries
                .iter()
                .find(|entry| entry.id == entry_id)
                .and_then(|entry| entry.expires_at_unix_seconds),
            None
        );
    }

    #[test]
    fn builtin_icon_request_is_bounded_and_projects_without_custom_icon_data() {
        let mut service = unlocked_service();
        let entry_id = service
            .snapshot()
            .expect("snapshot should exist")
            .entries
            .first()
            .expect("fixture entry")
            .id
            .clone();

        let updated = service
            .update_entry(UpdateEntryRequestDto {
                entry_id: entry_id.clone(),
                title: None,
                username: None,
                url: None,
                password: None,
                notes: None,
                expires: None,
                expiry_unix_seconds: None,
                totp_enabled: None,
                totp_uri: None,
                icon: Some(EntryIconRequestDto::BuiltIn { id: 68 }),
            })
            .expect("standard icon should update");
        let entry = updated
            .entries
            .iter()
            .find(|entry| entry.id == entry_id)
            .expect("updated entry should project");
        assert!(matches!(
            crate::dto::EntryIconDto::from(vault_core::EntryIconSummary::BuiltIn(68)),
            crate::dto::EntryIconDto::BuiltIn { id: 68 }
        ));
        assert!(matches!(
            entry.icon,
            crate::dto::EntryIconDto::BuiltIn { id: 68 }
        ));

        let before_invalid = service.snapshot().expect("snapshot");
        assert!(matches!(
            service.update_entry(UpdateEntryRequestDto {
                entry_id: entry_id.clone(),
                title: None,
                username: None,
                url: None,
                password: None,
                notes: None,
                expires: None,
                expiry_unix_seconds: None,
                totp_enabled: None,
                totp_uri: None,
                icon: Some(EntryIconRequestDto::BuiltIn { id: 69 }),
            }),
            Err(DesktopError::InvalidRequest)
        ));
        assert_eq!(
            service.snapshot().expect("snapshot after invalid").dirty,
            before_invalid.dirty
        );

        let cleared = service
            .update_entry(UpdateEntryRequestDto {
                entry_id: entry_id.clone(),
                title: None,
                username: None,
                url: None,
                password: None,
                notes: None,
                expires: None,
                expiry_unix_seconds: None,
                totp_enabled: None,
                totp_uri: None,
                icon: Some(EntryIconRequestDto::None),
            })
            .expect("icon should clear");
        assert!(matches!(
            cleared
                .entries
                .iter()
                .find(|entry| entry.id == entry_id)
                .expect("cleared entry")
                .icon,
            crate::dto::EntryIconDto::None
        ));
    }

    #[test]
    fn dirty_plain_lock_refuses_and_explicit_discard_locks_despite_clipboard_failure() {
        let source_before = fs::read(fixture_path()).expect("fixture should be readable");
        let state = AppState::new(Arc::new(FailingClipboard));
        {
            let mut service = state.service.lock().expect("service lock");
            service
                .select_path(fixture_path())
                .expect("fixture should select");
            let snapshot = service
                .unlock(SecretString::new(PASSWORD.to_owned()))
                .expect("fixture should unlock");
            assert!(matches!(
                service.close_policy(),
                crate::dto::ClosePolicyDto::Allow
            ));
            let entry = snapshot.entries.first().expect("fixture entry").id.clone();
            service
                .update_entry(UpdateEntryRequestDto {
                    entry_id: entry,
                    title: Some("dirty lock test".to_owned()),
                    username: None,
                    url: None,
                    password: None,
                    notes: None,
                    expires: None,
                    expiry_unix_seconds: None,
                    totp_enabled: None,
                    totp_uri: None,
                    icon: None,
                })
                .expect("mutation should succeed");
        }

        assert!(matches!(state.lock(), Err(DesktopError::UnsavedChanges)));
        assert!(
            state
                .service
                .lock()
                .expect("service lock")
                .snapshot()
                .expect("session must remain unlocked")
                .dirty
        );
        assert!(matches!(
            state.service.lock().expect("service lock").close_policy(),
            crate::dto::ClosePolicyDto::ConfirmDiscard
        ));
        assert!(state.discard_changes_and_lock().is_ok());
        assert!(matches!(
            state.service.lock().expect("service lock").snapshot(),
            Err(DesktopError::Locked)
        ));
        assert!(matches!(
            state.service.lock().expect("service lock").close_policy(),
            crate::dto::ClosePolicyDto::Allow
        ));
        assert_eq!(
            fs::read(fixture_path()).expect("fixture should remain readable"),
            source_before
        );
    }

    #[test]
    fn invalid_requests_and_unknown_ids_do_not_dirty_a_clean_session() {
        let mut service = unlocked_service();
        assert!(matches!(
            service.create_group(CreateGroupRequestDto {
                parent_group_id: String::new(),
                name: "valid".to_owned(),
            }),
            Err(DesktopError::InvalidRequest)
        ));
        assert!(matches!(
            service.delete_entry("unknown-entry".to_owned()),
            Err(DesktopError::EntryNotFound)
        ));
        let entry_id = service
            .snapshot()
            .expect("snapshot should exist")
            .entries
            .first()
            .expect("fixture entry")
            .id
            .clone();
        assert!(matches!(
            service.set_custom_field(SetCustomFieldRequestDto {
                entry_id,
                name: "Title".to_owned(),
                value: "synthetic".to_owned(),
                protection: FieldProtectionRequestDto::Protected,
            }),
            Err(DesktopError::ReservedField)
        ));
        assert!(!service.snapshot().expect("snapshot should exist").dirty);
    }

    #[test]
    fn existing_empty_name_custom_field_can_be_read_updated_and_deleted_exactly() {
        let mut service = unlocked_service();
        let entry_id = service
            .snapshot()
            .expect("snapshot should exist")
            .entries
            .first()
            .expect("fixture entry")
            .id
            .clone();
        let original = SecretString::new("synthetic-empty-name-value".to_owned());
        service
            .session_mut()
            .expect("session should remain unlocked")
            .set_entry_custom_field(
                &EntryId::new(entry_id.clone()),
                "",
                &original,
                FieldProtection::Protected,
            )
            .expect("domain API should prepare an existing empty-name field");
        assert_eq!(
            service
                .entry_custom_field(&entry_id, "")
                .expect("empty-name value should be readable")
                .expose_secret(),
            "synthetic-empty-name-value"
        );

        service
            .set_custom_field(SetCustomFieldRequestDto {
                entry_id: entry_id.clone(),
                name: String::new(),
                value: "updated-empty-name-value".to_owned(),
                protection: FieldProtectionRequestDto::Unprotected,
            })
            .expect("existing empty-name field should update");
        let detail = service
            .entry_detail(&entry_id)
            .expect("entry detail should remain available");
        assert!(detail.custom_fields.iter().any(|field| {
            field.name.is_empty()
                && matches!(field.protection, crate::dto::FieldProtectionDto::Protected)
        }));
        assert_eq!(
            service
                .entry_custom_field(&entry_id, "")
                .expect("updated value should be readable")
                .expose_secret(),
            "updated-empty-name-value"
        );

        let revision = service
            .session_mut()
            .expect("session should remain unlocked")
            .document()
            .revision();
        service
            .set_custom_field(SetCustomFieldRequestDto {
                entry_id: entry_id.clone(),
                name: String::new(),
                value: "updated-empty-name-value".to_owned(),
                protection: FieldProtectionRequestDto::Unprotected,
            })
            .expect("same value should remain a no-op");
        assert_eq!(
            service
                .session_mut()
                .expect("session should remain unlocked")
                .document()
                .revision(),
            revision
        );

        service
            .delete_custom_field(entry_id.clone(), String::new())
            .expect("existing empty-name field should delete");
        assert!(matches!(
            service.entry_custom_field(&entry_id, ""),
            Err(DesktopError::SecretUnavailable)
        ));
        assert!(matches!(
            service.set_custom_field(SetCustomFieldRequestDto {
                entry_id,
                name: String::new(),
                value: "must-not-create".to_owned(),
                protection: FieldProtectionRequestDto::Protected,
            }),
            Err(DesktopError::InvalidRequest)
        ));
    }

    #[test]
    fn secret_bearing_request_shapes_parse_without_entering_the_contract_fixture() {
        let update: UpdateEntryRequestDto = from_value(json!({
            "entryId": "entry-synthetic",
            "password": "M4.3-SYNTHETIC-PASSWORD",
            "notes": "M4.3-SYNTHETIC-NOTES"
        }))
        .expect("reviewed update request should parse");
        assert!(update.title.is_none());
        assert!(update.password.is_some());
        assert!(update.notes.is_some());
        assert!(
            from_value::<UpdateEntryRequestDto>(json!({
                "entryId": "entry-synthetic",
                "password": "synthetic",
                "unexpected": true
            }))
            .is_err()
        );
        let contract = include_str!("../../contracts/desktop-contract.json");
        assert!(!contract.contains("M4.3-SYNTHETIC-PASSWORD"));
        assert!(!contract.contains("M4.3-SYNTHETIC-NOTES"));
    }
}
