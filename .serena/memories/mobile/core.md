# Mobile boundaries

- Android owns platform lifecycle and source/grant interactions; Rust `MobileVaultSession` owns mobile vault operations. SAF URIs are opaque native source tokens, not canonical desktop filesystem paths.
- Remembered source access is explicit opt-in and limited to encrypted bookmark metadata. Do not persist a master password or make a remembered grant writable without reviewed authority.
- Privacy-cover removal requires a safe-UI acknowledgement for the same Activity generation. Main and credential Activities have independent focus/resume authority; process foreground alone is too delayed to authorize uncovering.
- iOS Password AutoFill remains deferred. Retained Swift/FFI foundations do not count as an initialized, built, signed, or runtime-verified iOS feature.
- Read M5.2–M5.5 and deferred Apple sections in `docs/architecture.md`, `docs/threat-model.md`, and `docs/quality.md`; key Rust path is `apps/desktop/src-tauri/src/mobile`, with native sources under `apps/desktop/src-tauri/gen/android` and `gen/apple`.