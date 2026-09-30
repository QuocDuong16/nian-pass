# Browser credential boundary

- Chromium and Firefox MV3 share one manifest source. Site access is optional and user-enabled per site; exact top-frame origin, document/field identity, navigation, permission, connection, and generation must be revalidated at fill time.
- Trust flows from hostile page/DOM through isolated content script to background authority, then transport-only Native Messaging host, explicit desktop Allow/Deny, `DesktopVaultService`/current `VaultSession`, and exact-origin credential provider.
- The popup receives opaque candidate handles/summaries, not credentials. A credential goes only to the exact authorized content port; filling never submits the form.
- A service worker restart or transport reconnection loses candidate handles and requires renewed desktop approval. Browser permission is not credential identity.
- Source map: `apps/browser-extension`, `apps/browser-native-host`, `apps/desktop/src-tauri/src/browser_bridge.rs`, `crates/browser-native-protocol`, and `crates/credential-provider-core`. Read M6/M6.5 in `docs/architecture.md` and `docs/threat-model.md` before changing authority flow.