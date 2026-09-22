use std::collections::HashSet;

use serde::Deserialize;
use vault_core::{EntryId, GroupId};

use super::require_id;
use crate::dto::VaultSnapshotDto;
use crate::state::{DesktopError, DesktopVaultService, map_mutation_error};

const MAX_BULK_ENTRY_COUNT: usize = 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BulkMoveEntriesRequestDto {
    entry_ids: Vec<String>,
    destination_group_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BulkTrashEntriesRequestDto {
    entry_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BulkRestoreEntriesRequestDto {
    entry_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BulkDeleteEntriesRequestDto {
    entry_ids: Vec<String>,
}

impl DesktopVaultService {
    pub fn move_entries_bulk(
        &mut self,
        request: BulkMoveEntriesRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        let entries = parse_entry_ids(request.entry_ids)?;
        require_id(&request.destination_group_id)?;
        let destination = GroupId::new(request.destination_group_id);
        let session = self.session_mut()?;
        if session
            .group_is_recycled(&destination)
            .map_err(map_mutation_error)?
        {
            return Err(DesktopError::InvalidRequest);
        }
        for entry in &entries {
            if session
                .document()
                .entry_is_recycled(entry)
                .map_err(|_| DesktopError::InvalidRequest)?
            {
                return Err(DesktopError::InvalidRequest);
            }
        }
        session
            .move_entries(&entries, &destination)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn trash_entries_bulk(
        &mut self,
        request: BulkTrashEntriesRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        let entries = parse_entry_ids(request.entry_ids)?;
        self.session_mut()?
            .trash_entries(&entries)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn restore_entries_bulk(
        &mut self,
        request: BulkRestoreEntriesRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        let entries = parse_entry_ids(request.entry_ids)?;
        self.session_mut()?
            .restore_entries(&entries)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }

    pub fn permanently_delete_entries_bulk(
        &mut self,
        request: BulkDeleteEntriesRequestDto,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        let entries = parse_entry_ids(request.entry_ids)?;
        self.session_mut()?
            .permanently_delete_recycled_entries(&entries)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }
}

fn parse_entry_ids(values: Vec<String>) -> Result<Vec<EntryId>, DesktopError> {
    if values.is_empty() || values.len() > MAX_BULK_ENTRY_COUNT {
        return Err(DesktopError::InvalidRequest);
    }
    let mut seen = HashSet::with_capacity(values.len());
    let mut entries = Vec::with_capacity(values.len());
    for value in values {
        require_id(&value)?;
        if !seen.insert(value.clone()) {
            return Err(DesktopError::InvalidRequest);
        }
        entries.push(EntryId::new(value));
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use serde_json::{from_value, json};

    use super::{
        BulkDeleteEntriesRequestDto, BulkMoveEntriesRequestDto, BulkRestoreEntriesRequestDto,
        BulkTrashEntriesRequestDto,
    };

    #[test]
    fn bulk_id_validation_rejects_empty_duplicate_and_oversized_batches() {
        assert!(super::parse_entry_ids(Vec::new()).is_err());
        assert!(super::parse_entry_ids(vec!["entry-a".to_owned(), "entry-a".to_owned()]).is_err());
        let oversized = (0..=super::MAX_BULK_ENTRY_COUNT)
            .map(|index| format!("entry-{index}"))
            .collect();
        assert!(super::parse_entry_ids(oversized).is_err());
    }

    #[test]
    fn bulk_requests_are_exact_and_secret_free() {
        let move_request = from_value::<BulkMoveEntriesRequestDto>(json!({
            "entryIds": ["entry-a", "entry-b"],
            "destinationGroupId": "group-b"
        }));
        assert!(move_request.is_ok());
        let trash_request = from_value::<BulkTrashEntriesRequestDto>(json!({
            "entryIds": ["entry-a", "entry-b"]
        }));
        assert!(trash_request.is_ok());
        let restore_request = from_value::<BulkRestoreEntriesRequestDto>(json!({
            "entryIds": ["entry-a", "entry-b"]
        }));
        assert!(restore_request.is_ok());
        let delete_request = from_value::<BulkDeleteEntriesRequestDto>(json!({
            "entryIds": ["entry-a", "entry-b"]
        }));
        assert!(delete_request.is_ok());
        assert!(
            from_value::<BulkTrashEntriesRequestDto>(json!({
                "entryIds": ["entry-a"],
                "password": "must-not-cross"
            }))
            .is_err()
        );
    }
}
