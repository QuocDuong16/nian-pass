use tauri::State;

use crate::{
    command_support::with_service,
    dto::{
        DatabaseMetadataDto, DatabaseMetadataUpdateReceiptDto, HistoryPolicyDto,
        HistoryPolicyUpdateReceiptDto, VaultSnapshotDto,
    },
    errors::DesktopErrorDto,
    state::AppState,
};

#[tauri::command]
pub fn database_metadata(
    state: State<'_, AppState>,
) -> Result<DatabaseMetadataDto, DesktopErrorDto> {
    with_service(state, |service| service.database_metadata())
}

#[tauri::command]
pub fn update_database_metadata(
    name: String,
    description: String,
    default_username: String,
    state: State<'_, AppState>,
) -> Result<DatabaseMetadataUpdateReceiptDto, DesktopErrorDto> {
    with_service(state, |service| {
        service.update_database_metadata(&name, &description, &default_username)
    })
}

#[tauri::command]
pub fn history_policy(state: State<'_, AppState>) -> Result<HistoryPolicyDto, DesktopErrorDto> {
    with_service(state, |service| service.history_policy())
}

#[tauri::command]
pub fn set_history_max_items(
    max_items: Option<usize>,
    state: State<'_, AppState>,
) -> Result<HistoryPolicyUpdateReceiptDto, DesktopErrorDto> {
    with_service(state, |service| service.set_history_max_items(max_items))
}

#[tauri::command]
pub fn set_recycle_bin_enabled(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<VaultSnapshotDto, DesktopErrorDto> {
    with_service(state, |service| service.set_recycle_bin_enabled(enabled))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::Arc,
        time::{SystemTime, UNIX_EPOCH},
    };

    use serde_json::to_value;
    use tauri::{
        Manager,
        test::{mock_builder, mock_context, noop_assets},
    };
    use vault_core::{NewEntry, SecretString};

    use super::{
        database_metadata, history_policy, set_history_max_items, set_recycle_bin_enabled,
        update_database_metadata,
    };
    use crate::{clipboard::ClipboardPort, state::AppState};

    struct NoopClipboard;

    impl ClipboardPort for NoopClipboard {
        fn write_text(&self, _value: &str) -> Result<(), ()> {
            Ok(())
        }
        fn read_text(&self) -> Result<Option<String>, ()> {
            Ok(None)
        }
        fn clear(&self) -> Result<(), ()> {
            Ok(())
        }
    }

    #[test]
    fn database_metadata_commands_are_explicit_bounded_and_return_dirty_receipts() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let state = AppState::new(Arc::new(NoopClipboard));
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "nian-pass-database-metadata-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("temp dir");
        state
            .service
            .lock()
            .expect("service")
            .create(
                directory.join("vault.kdbx"),
                "Metadata",
                SecretString::new("fixture".to_owned()),
            )
            .expect("create vault");
        app.manage(state.clone());

        let Ok(initial) = database_metadata(app.state::<AppState>()) else {
            panic!("metadata read should succeed")
        };
        assert!(initial.name.is_empty());
        let Ok(receipt) = update_database_metadata(
            "Personal".to_owned(),
            "Primary vault".to_owned(),
            "fixture-user".to_owned(),
            app.state::<AppState>(),
        ) else {
            panic!("metadata update should succeed")
        };
        assert_eq!(receipt.metadata.name, "Personal");
        assert_eq!(receipt.metadata.default_username, "fixture-user");
        assert!(receipt.snapshot.dirty);
        let Ok(reread) = database_metadata(app.state::<AppState>()) else {
            panic!("metadata reread should succeed")
        };
        assert_eq!(reread.name, receipt.metadata.name);
        assert_eq!(reread.description, receipt.metadata.description);
        assert_eq!(reread.default_username, receipt.metadata.default_username);

        let oversized = "x".repeat(kdbx::MAX_DATABASE_NAME_BYTES + 1);
        let rejected = update_database_metadata(
            oversized,
            String::new(),
            String::new(),
            app.state::<AppState>(),
        );
        let Err(rejected) = rejected else {
            panic!("oversized metadata must fail")
        };
        assert_eq!(
            to_value(rejected).expect("error serialization"),
            serde_json::json!({ "code": "invalid_request" })
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn history_policy_commands_are_bounded_and_return_canonical_dirty_receipts() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let state = AppState::new(Arc::new(NoopClipboard));
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "nian-pass-history-policy-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("temp dir");
        {
            let mut service = state.service.lock().expect("service");
            service
                .create(
                    directory.join("vault.kdbx"),
                    "History settings",
                    SecretString::new("fixture".to_owned()),
                )
                .expect("create vault");
        }
        app.manage(state.clone());

        let initial = history_policy(app.state::<AppState>());
        let Ok(initial) = initial else {
            panic!("history policy should load")
        };
        assert_eq!(
            to_value(&initial).expect("policy serialization"),
            serde_json::json!({
                "maxItems": null,
                "maximumEditableItems": initial.maximum_editable_items
            })
        );

        let updated = set_history_max_items(Some(2), app.state::<AppState>());
        let Ok(updated) = updated else {
            panic!("history policy update should succeed")
        };
        let value = to_value(updated).expect("receipt serialization");
        assert_eq!(value["policy"]["maxItems"], serde_json::json!(2));
        assert_eq!(
            value["policy"]["maximumEditableItems"],
            serde_json::json!(initial.maximum_editable_items)
        );
        assert_eq!(value["snapshot"]["dirty"], serde_json::json!(true));

        let rejected = set_history_max_items(
            Some(initial.maximum_editable_items + 1),
            app.state::<AppState>(),
        );
        let Err(rejected) = rejected else {
            panic!("oversized history policy must reject")
        };
        assert_eq!(
            to_value(rejected).expect("error serialization"),
            serde_json::json!({ "code": "invalid_request" })
        );
        let reread = history_policy(app.state::<AppState>());
        let Ok(reread) = reread else {
            panic!("history policy should remain readable")
        };
        assert_eq!(reread.max_items, Some(2));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn recycle_bin_command_updates_canonical_snapshot_and_rejects_nonempty_disable() {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app");
        let state = AppState::new(Arc::new(NoopClipboard));
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "nian-pass-recycle-setting-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("temp dir");
        {
            let mut service = state.service.lock().expect("service");
            service
                .create(
                    directory.join("vault.kdbx"),
                    "Recycle settings",
                    SecretString::new("fixture".to_owned()),
                )
                .expect("create vault");
        }
        app.manage(state.clone());

        let disabled = set_recycle_bin_enabled(false, app.state::<AppState>());
        let Ok(disabled) = disabled else {
            panic!("disable should succeed")
        };
        assert!(!disabled.recycle_bin_enabled);
        assert!(disabled.dirty);

        let enabled = set_recycle_bin_enabled(true, app.state::<AppState>());
        let Ok(enabled) = enabled else {
            panic!("enable should succeed")
        };
        assert!(enabled.recycle_bin_enabled);
        {
            let mut service = state.service.lock().expect("service");
            let session = service.session_mut().expect("session");
            let root = session
                .projection()
                .expect("projection")
                .root()
                .id()
                .clone();
            let entry = session
                .create_entry(
                    &root,
                    NewEntry {
                        title: "Trash me",
                        username: "",
                        url: "",
                        password: None,
                    },
                    None,
                )
                .expect("entry");
            session.trash_entry(&entry).expect("trash");
        }

        let rejected = set_recycle_bin_enabled(false, app.state::<AppState>());
        let Err(rejected) = rejected else {
            panic!("nonempty Trash must reject disable")
        };
        assert_eq!(
            to_value(rejected).expect("error serialization"),
            serde_json::json!({ "code": "invalid_request" })
        );
        let snapshot = state
            .service
            .lock()
            .expect("service")
            .snapshot()
            .expect("snapshot");
        assert!(snapshot.recycle_bin_enabled);
        let _ = fs::remove_dir_all(directory);
    }
}
