use tauri::State;

use crate::{
    command_support::with_service,
    dto::{
        CreatedEntryDto, CreatedGroupDto, EntryHistoryDto, PasswordHealthReportDto,
        VaultSnapshotDto,
    },
    errors::DesktopErrorDto,
    mutations::{
        BulkDeleteEntriesRequestDto, BulkMoveEntriesRequestDto, BulkRestoreEntriesRequestDto,
        BulkTrashEntriesRequestDto, CreateEntryRequestDto, CreateGroupRequestDto,
        MoveEntryRequestDto, MoveGroupRequestDto, RenameGroupRequestDto, SetCustomFieldRequestDto,
        SetEntryTagsRequestDto, UpdateEntryRequestDto,
    },
    state::{AppState, DesktopError},
};

#[tauri::command]
pub fn update_entry(
    request: UpdateEntryRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.update_entry(request))
}

#[tauri::command]
pub fn set_entry_tags(
    request: SetEntryTagsRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.set_entry_tags(request))
}

#[tauri::command]
pub fn create_entry(
    request: CreateEntryRequestDto,
    state: State<'_, AppState>,
) -> Result<CreatedEntryDto, DesktopErrorDto> {
    with_service(state, |service| service.create_entry(request))
}

#[tauri::command]
pub fn duplicate_entry(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<CreatedEntryDto, DesktopErrorDto> {
    with_service(state, |service| service.duplicate_entry(entry_id))
}

#[tauri::command]
pub fn password_health_report(
    state: State<'_, AppState>,
) -> Result<PasswordHealthReportDto, DesktopErrorDto> {
    with_service(state, |service| service.password_health_report())
}

#[tauri::command]
pub fn entry_history(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<EntryHistoryDto, DesktopErrorDto> {
    with_service(state, |service| service.entry_history(&entry_id))
}

#[tauri::command]
pub fn restore_entry_history(
    entry_id: String,
    history_index: usize,
    expected_document_revision: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    let expected_document_revision = expected_document_revision
        .parse::<u64>()
        .map_err(|_| DesktopErrorDto::from(DesktopError::InvalidRequest))?;
    with_service(state, |service| {
        service.restore_entry_history(&entry_id, history_index, expected_document_revision)
    })
}

#[tauri::command]
pub fn delete_entry(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.delete_entry(entry_id))
}

#[tauri::command]
pub fn restore_entry(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.restore_entry(entry_id))
}

#[tauri::command]
pub fn permanently_delete_entry(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.permanently_delete_entry(entry_id))
}

#[tauri::command]
pub fn move_entry(
    request: MoveEntryRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.move_entry(request))
}

#[tauri::command]
pub fn move_entries(
    request: BulkMoveEntriesRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.move_entries_bulk(request))
}

#[tauri::command]
pub fn trash_entries(
    request: BulkTrashEntriesRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.trash_entries_bulk(request))
}

#[tauri::command]
pub fn restore_entries(
    request: BulkRestoreEntriesRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.restore_entries_bulk(request))
}

#[tauri::command]
pub fn permanently_delete_entries(
    request: BulkDeleteEntriesRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| {
        service.permanently_delete_entries_bulk(request)
    })
}

#[tauri::command]
pub fn create_group(
    request: CreateGroupRequestDto,
    state: State<'_, AppState>,
) -> Result<CreatedGroupDto, DesktopErrorDto> {
    with_service(state, |service| service.create_group(request))
}

#[tauri::command]
pub fn rename_group(
    request: RenameGroupRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.rename_group(request))
}

#[tauri::command]
pub fn move_group(
    request: MoveGroupRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.move_group(request))
}

#[tauri::command]
pub fn delete_group(
    group_id: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.delete_group(group_id))
}

#[tauri::command]
pub fn restore_group(
    group_id: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.restore_group(group_id))
}

#[tauri::command]
pub fn permanently_delete_group(
    group_id: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.permanently_delete_group(group_id))
}

#[tauri::command]
pub fn set_entry_custom_field(
    request: SetCustomFieldRequestDto,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.set_custom_field(request))
}

#[tauri::command]
pub fn delete_entry_custom_field(
    entry_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.delete_custom_field(entry_id, name))
}
