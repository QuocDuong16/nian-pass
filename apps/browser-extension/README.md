# Nian Pass Browser Integration

This package is the M6.5 Chromium/Firefox MV3 browser boundary. It provides
explicit per-site credential filling through the running Nian Pass desktop and
never opens a vault or asks for a KDBX master password.

## Architecture

```text
HTTP(S) page
→ isolated top-frame content script
→ validated internal extension Port
→ background authority
→ runtime.connectNative("io.nianpass.browser")
→ Nian Pass native host
→ user-local OS IPC
→ explicit desktop approval
→ DesktopVaultService / credential-provider-core
→ exact document and exact field handles
→ fill only; no submit
```

Site access stays optional. The popup directly owns the Enable/Disable user
gesture; the background owns browser-derived tab, frame, origin, current
permission, internal Port, and Native Messaging authority. Only
`background-native.ts` calls `connectNative`, and only background channel
infrastructure owns `runtime.onConnect`.

The value-blind detector never reads `input.value`. It reports a fill target
only for one unambiguous eligible password field and zero or one username field,
using random per-document opaque handles. Cross-origin frames, Shadow DOM, and
ambiguous multiple login forms are unsupported.

Opening the popup does not connect automatically. The user presses Connect to
Nian Pass and approves the new connection in desktop. Approval and candidate
state are memory-only and session-scoped. A service-worker, native-host, or
desktop restart requires reconnecting and approving again.

Candidate lists contain only random candidate handles, title summaries,
username summaries/protected markers, and a truncation signal. Candidate handles
bind the exact tab, origin, document nonce, field handles, native generation,
and vault session. They are single-use and invalidated by navigation, origin or
permission change, Port replacement, native disconnect, tab close, or a new
vault session.

Before requesting a secret and again after receiving it, background revalidates
the complete browser authority. A stale response is dropped and cannot mutate
the new document. The password never passes through popup messages or DOM and is
not stored in localStorage, extension storage, IndexedDB, logs, or a retry
queue. JavaScript strings cannot be reliably zeroized, so their lifetime and
references are minimized without claiming secure erase.

## Permissions and identities

Required permissions are exactly `activeTab`, `scripting`, and
`nativeMessaging`; HTTP(S) host patterns remain optional. The fixed native host
name is `io.nianpass.browser`.

- Chromium development ID: `hikglhjadglkpicocjdjipeifnemoplg`, derived from the
  committed public Manifest `key`. This is not guaranteed to be the final Chrome
  Web Store ID. No private signing key is committed.
- Firefox development ID: `browser@nian-pass.local`. Publishing may replace it
  during release engineering.

## Commands

```text
make browser-source-check
make browser-extension-check
make browser-native-protocol-check
make browser-native-host-check
make browser-integration-check
```

Deterministic checks build both extension artifacts, validate the shared
Rust/TypeScript protocol fixture, spawn the real native host against fake local
IPC, and cover browser navigation/permission/session races. They do not require
or launch an installed browser.

## Security and limitations

Ordinary HTTPS origins are supported. Rust rejects arbitrary plaintext HTTP;
loopback HTTP is narrowly available for development. Filling is top-frame only,
requires explicit candidate selection, and never automatically submits.

Browser credential storage is none. Persistent browser pairing is none. The
browser never receives the master password. M6.5 does not provide passkeys,
TOTP, HTTP Auth, automatic fill, store publication, or trusted-browser
remembering.

Nian Pass uses standard Native Messaging transport but does not implement the
KeePassXC-Browser wire protocol and requires no KeePassXC proxy or executable.
Any future interoperability work must be a separate clean-room/API-level
adapter; this package makes no compatibility claim.
