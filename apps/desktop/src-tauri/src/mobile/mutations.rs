#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use kdbx::KdbxError;
use serde::Deserialize;
use vault_core::{EntryId, EntryUpdate, FieldProtection, GroupId, NewEntry, SecretString};

use crate::dto::{CreatedEntryDto, CreatedGroupDto, VaultSnapshotDto};

use super::{MobileError, session::MobileVaultSession};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MobileUpdateEntryRequest {
    pub(super) entry_id: String,
    pub(super) title: Option<String>,
    pub(super) username: Option<String>,
    pub(super) url: Option<String>,
    pub(super) password: Option<String>,
    pub(super) notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MobileCreateEntryRequest {
    group_id: String,
    title: String,
    username: String,
    url: String,
    password: Option<String>,
    notes: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MobileMoveEntryRequest {
    entry_id: String,
    destination_group_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MobileCreateGroupRequest {
    parent_group_id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MobileRenameGroupRequest {
    group_id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MobileMoveGroupRequest {
    group_id: String,
    destination_group_id: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MobileFieldProtectionRequest {
    Protected,
    Unprotected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MobileSetCustomFieldRequest {
    entry_id: String,
    name: String,
    value: String,
    protection: MobileFieldProtectionRequest,
}

impl MobileVaultSession {
    pub(super) fn update_entry(
        &mut self,
        request: MobileUpdateEntryRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        require_id(&request.entry_id)?;
        let password = request.password.map(SecretString::new);
        let notes = request.notes.map(SecretString::new);
        self.document
            .update_entry(
                &EntryId::new(request.entry_id),
                EntryUpdate {
                    title: request.title.as_deref(),
                    username: request.username.as_deref(),
                    url: request.url.as_deref(),
                    password: password.as_ref(),
                    notes: notes.as_ref(),
                },
            )
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub(super) fn create_entry(
        &mut self,
        request: MobileCreateEntryRequest,
    ) -> Result<CreatedEntryDto, MobileError> {
        require_id(&request.group_id)?;
        let password = request.password.map(SecretString::new);
        let notes = request.notes.map(SecretString::new);
        let created = self
            .document
            .create_entry_with_notes(
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

    pub(super) fn delete_entry(
        &mut self,
        entry_id: String,
    ) -> Result<VaultSnapshotDto, MobileError> {
        require_id(&entry_id)?;
        self.document
            .permanently_delete_entry(&EntryId::new(entry_id))
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub(super) fn move_entry(
        &mut self,
        request: MobileMoveEntryRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        require_id(&request.entry_id)?;
        require_id(&request.destination_group_id)?;
        self.document
            .move_entry(
                &EntryId::new(request.entry_id),
                &GroupId::new(request.destination_group_id),
            )
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub(super) fn create_group(
        &mut self,
        request: MobileCreateGroupRequest,
    ) -> Result<CreatedGroupDto, MobileError> {
        require_id(&request.parent_group_id)?;
        require_name(&request.name)?;
        let created = self
            .document
            .create_group(&GroupId::new(request.parent_group_id), &request.name)
            .map_err(map_mutation_error)?;
        Ok(CreatedGroupDto {
            created_group_id: created.as_str().to_owned(),
            snapshot: self.snapshot()?,
        })
    }

    pub(super) fn rename_group(
        &mut self,
        request: MobileRenameGroupRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        require_id(&request.group_id)?;
        require_name(&request.name)?;
        self.document
            .rename_group(&GroupId::new(request.group_id), &request.name)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub(super) fn move_group(
        &mut self,
        request: MobileMoveGroupRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        require_id(&request.group_id)?;
        require_id(&request.destination_group_id)?;
        self.document
            .move_group(
                &GroupId::new(request.group_id),
                &GroupId::new(request.destination_group_id),
            )
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub(super) fn delete_group(
        &mut self,
        group_id: String,
    ) -> Result<VaultSnapshotDto, MobileError> {
        require_id(&group_id)?;
        self.document
            .permanently_delete_group(&GroupId::new(group_id))
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub(super) fn set_custom_field(
        &mut self,
        request: MobileSetCustomFieldRequest,
    ) -> Result<VaultSnapshotDto, MobileError> {
        require_id(&request.entry_id)?;
        let entry = EntryId::new(request.entry_id);
        let exists = self
            .document
            .custom_fields(&entry)
            .map_err(map_mutation_error)?
            .iter()
            .any(|field| field.name() == request.name);
        if !exists {
            require_name(&request.name)?;
        }
        let value = SecretString::new(request.value);
        let protection = match request.protection {
            MobileFieldProtectionRequest::Protected => FieldProtection::Protected,
            MobileFieldProtectionRequest::Unprotected => FieldProtection::Unprotected,
        };
        self.document
            .set_entry_custom_field(&entry, &request.name, &value, protection)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub(super) fn delete_custom_field(
        &mut self,
        entry_id: String,
        name: String,
    ) -> Result<VaultSnapshotDto, MobileError> {
        require_id(&entry_id)?;
        self.document
            .delete_entry_custom_field(&EntryId::new(entry_id), &name)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }
}

pub(super) fn require_id(value: &str) -> Result<(), MobileError> {
    if value.is_empty() {
        Err(MobileError::InvalidRequest)
    } else {
        Ok(())
    }
}

fn require_name(value: &str) -> Result<(), MobileError> {
    if value.trim().is_empty() {
        Err(MobileError::InvalidRequest)
    } else {
        Ok(())
    }
}

pub(super) fn map_mutation_error(error: KdbxError) -> MobileError {
    match error {
        KdbxError::EntryNotFound => MobileError::EntryNotFound,
        KdbxError::GroupNotFound => MobileError::GroupNotFound,
        KdbxError::CannotDeleteRootGroup | KdbxError::InvalidGroupMove => MobileError::Conflict,
        KdbxError::ReservedField => MobileError::InvalidRequest,
        _ => MobileError::Internal,
    }
}
