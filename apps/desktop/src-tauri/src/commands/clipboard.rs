use tauri::State;

use crate::{command_support, dto::ClipboardReceiptDto, errors::DesktopErrorDto, state::AppState};

#[tauri::command]
pub async fn copy_entry_title(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    command_support::copy_entry_title(entry_id, state.inner().clone()).await
}

#[tauri::command]
pub async fn copy_entry_username(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    command_support::copy_entry(entry_id, state.inner().clone(), false).await
}

#[tauri::command]
pub async fn copy_entry_url(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    command_support::copy_entry_url(entry_id, state.inner().clone()).await
}

#[tauri::command]
pub async fn copy_entry_notes(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    command_support::copy_entry_notes(entry_id, state.inner().clone()).await
}

#[tauri::command]
pub async fn copy_entry_custom_field(
    entry_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    command_support::copy_entry_custom_field(entry_id, name, state.inner().clone()).await
}

#[tauri::command]
pub async fn copy_entry_totp_code(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    command_support::copy_entry_totp(entry_id, state.inner().clone()).await
}

/// Browser-generated secret is accepted only for an unlocked vault, bounded,
/// copied through the existing native clipboard lease, and never returned.
#[tauri::command]
pub async fn copy_generated_password(
    password: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    command_support::copy_generated_password(password, state.inner().clone()).await
}

#[tauri::command]
pub async fn copy_entry_password(
    entry_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardReceiptDto, DesktopErrorDto> {
    command_support::copy_entry(entry_id, state.inner().clone(), true).await
}
