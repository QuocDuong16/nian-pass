# Tauri IPC security inventory

All commands are compile-time platform-scoped and registered in
`apps/desktop/src-tauri/src/lib.rs`. Custom commands are callable only by the
local bundled WebView; CSP and the main-window capability deny remote content.

| Class | Commands | Authority and secret boundary |
| --- | --- | --- |
| Utility | `runtime_info` | Public build/platform metadata only. |
| Session control | `select_vault`, `select_keyfile`, `clear_keyfile`, unlock/snapshot/lock/close commands, mobile equivalents | Native vault/keyfile selection; raw keyfile bytes stay in Rust. Password inputs become `SecretString`; snapshots are secret-free. |
| Vault read | entry detail/history/attachments/password-health/reveal/copy commands, `database_metadata`, `history_policy`, and mobile read equivalents | Exact unlocked session required. Metadata/policy reads are secret-free; TOTP codes are ephemeral; seeds/URIs never cross IPC. |
| Standalone generator clipboard | `copy_generated_password` | Requires an unlocked desktop session; validates a nonempty, bounded printable-ASCII input from the WebView. Uses native clipboard ownership/expiry, returns only a secret-free copy receipt, and does not mutate the vault. The generated value itself is transient WebView memory and crosses IPC for this explicit copy only. |
| Vault mutation | entry/group/tag/custom-field, bulk/recycle/history/attachment mutations, `set_recycle_bin_enabled`, `set_history_max_items`, custom-icon import and mobile equivalents | Secret-free snapshots/receipts. Native bounded file import keeps bytes/path outside React; atomic bulk requests cap 1024 unique IDs. Database policy changes are in-memory mutations and require explicit Save; lowering `HistoryMaxItems` prunes older revisions before returning the canonical dirty snapshot. |
| External URL open | `open_entry_url` | Desktop-only. Rust re-reads the selected entry, accepts only visible/unprotected absolute HTTP(S) URLs with a host and no embedded userinfo, canonicalizes with `url`, and launches via direct argv without shell parsing. Protected/missing URLs never reach the launcher. |
| Native attachment export | `export_entry_attachment` | Native save picker; bytes stay in Rust. |
| Save/reload/credential | `save_vault`, `reload_vault`, `change_master_password`, `remove_master_password`, `credential_has_keyfile`, `credential_has_password`, `replace_keyfile`, `remove_keyfile`, mobile equivalents | Clean writable vault required for credential rotation. Rust owns credential components; boolean status and secret-free receipts only. Never remove the last usable component. |
| Encrypted export copy | `export_vault_copy` | Native save picker. Rust writes only to a new verified KDBX destination; existing files are never overwritten and the active source/sync binding does not change. |
| Sync | profile CRUD/reset, provider test, `sync_now`, conflict resolve | Desktop-only CAS/recovery; optional password IPC, retained keyfile Rust-only. No secret profile fields. |
| Browser | `resolve_browser_connection` | Opaque approval state only; credential data never enters React. |
| Android Credential/Autofill | `mobile_autofill_*`, settings/enable/disable, security resume/ack | Native request identity stays native/Rust; explicit OTP fields receive only a current Rust-generated code at final fulfillment. |
| Apple retained bridge | iOS read-only command registration behind iOS cfg | Read-only inspection and explicit current-TOTP reveal; CRUD/Save and Password AutoFill remain deferred. |

Credential changes reuse retained Rust authority and the verified atomic Save
transaction. `remove_master_password` requires a retained keyfile and returns a
clean secret-free snapshot; `remove_keyfile` requires a nonempty retained
password. The status commands expose only booleans, keyfile replacement returns
at most a filename, and keyfile bytes and native paths stay inside Rust. An
uncertain write is reconciled against the actual canonical vault generation;
historical backups may still use the previous credential.

No dead command was identified: each registered supported-platform command has a
single frontend/native consumer and focused contract/source tests. Adding a
command requires registration, authority classification, secret argument/return
review, platform cfg review, and a source/contract test.
