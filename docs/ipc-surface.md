# Tauri IPC security inventory

All commands are compile-time platform-scoped and registered in
`apps/desktop/src-tauri/src/lib.rs`. Custom commands are callable only by the
local bundled WebView; CSP and the main-window capability deny remote content.

| Class | Commands | Authority and secret boundary |
|---|---|---|
| Utility | `runtime_info` | No session; returns only platform classification, user-facing version, and commit SHA (or `unknown`). |
| Session control | `select_vault`, `unlock_vault`, `vault_snapshot`, `lock_vault`, `discard_changes_and_lock`, `close_policy`, mobile equivalents | Selection is native; unlock password is a secret argument converted immediately to `SecretString`; snapshots/results are secret-free. Lock owns session/clipboard/source transition. |
| Vault read | `entry_detail`, explicit `reveal_entry_*`, `copy_entry_*`, mobile load equivalents | Requires current unlocked session and entry identity. Reveal returns the explicitly requested plaintext to the WebView; copy keeps plaintext in Rust/OS clipboard. |
| Vault mutation | entry/group/custom-field create, update, move, delete commands and mobile equivalents | Requires current session; request fields can contain private/secret text; returns secret-free snapshot. Dirty authority stays Rust-owned. |
| Save/reload | `save_vault`, `reload_vault`, mobile equivalents | Requires session and explicit password; safe-save/source transaction decides completion. No optimistic clean state. |
| Sync | profile list/save/delete/reset, provider test, `sync_now`, conflict resolve | Desktop only. Profile DTO is non-secret; provider/master credentials are request-only. Sync requires clean exact session and CAS/recovery authority. |
| Browser | `resolve_browser_connection` | Desktop only. Frontend receives/returns opaque approval ID plus allow/deny. Candidate and credential data never enters React. |
| Android Credential/Autofill | `mobile_autofill_*`, settings/enable/disable, security resume/ack | Android only. Native request IDs, framework structures, URI/source handles, grant state, and Activity identity remain native/Rust; frontend receives bounded semantic DTOs. |
| Apple retained bridge | iOS command registration behind iOS cfg | Deferred and unsupported. M8 does not build, register, or validate an Apple runtime. |

No dead command was identified: each registered supported-platform command has a
single frontend/native consumer and focused contract/source tests. Adding a
command requires registration, authority classification, secret argument/return
review, platform cfg review, and a source/contract test.
