# Nian Pass Browser Extension Foundation

This package is M6: a Manifest V3 browser boundary for Chromium-family browsers
and Firefox. It is not browser autofill and has no vault or credential source.

## Architecture

```text
HTTP(S) page
→ explicit per-site browser permission
→ isolated top-frame content script
→ secret-free structural detection
→ validated browser-owned sender metadata
→ background authority
→ popup/status UI

M6.5 later:
background authority → Native Messaging → desktop/shared Rust authority
```

The web page/DOM is untrusted, the content script is a low-trust adapter, the
background is privileged browser authority, and native Rust will be the future
credential authority. M6 never trusts a URL claimed inside a content message.
Cross-origin frame credential filling is deferred. M6 browser form detection is
top-frame only. Open and closed Shadow DOM traversal is deferred.

Required permissions are exactly `activeTab` and `scripting`. HTTP(S) host
patterns are optional. Background-derived status gives the popup the active
tab's canonical host pattern before any click. Clicking Enable or Disable calls
`permissions.request` or `permissions.remove` immediately in that popup user
gesture; the background never mutates optional permission. Permission events
then reconcile one dynamic registration from browser state. Browser settings
may also revoke access and drive the same reconciliation. A tab change while a
popup remains open is a residual browser-UI race: after the operation, refreshed
status is derived again from the browser's current active tab and is never
displayed against the old site.

The detector reports only protocol version, a random document nonce, login-form
presence, password-field count, username-candidate count, and form count. It
never reads field values. A synthetic-only fill primitive binds the exact
document and opaque live field handles, emits `input` and `change`, and never
submits. No production path supplies or requests a credential.

Each content document initiates the fixed internal extension Port
`nian-pass-content-v1` and sends an exact `documentHello` containing only its
protocol version and nonce. Background accepts it only for this extension's
permitted HTTP(S) top frame, using browser-owned sender tab, frame, and URL
metadata. The ephemeral binding stores only tab/frame, exact origin, nonce, and
Port reference; a replacement document retires the old Port. Popup and other
extension pages have no tab-bound sender authority and cannot deliver fill
commands. Background-state loss fails closed; content performs at most one
bounded reconnect and no secret is queued.

The popup's `permissionPattern` is browser site-access authority only. Browser
host permission is not credential identity. M6.5 must revalidate the
browser-provided exact current origin/host with Rust credential policy before
release. The browser extension must never receive a KDBX master password, parse
KDBX, retain a credential response, or use browser storage as a credential
cache.

## Targets and identity

- `dist/chromium`: MV3 `background.service_worker`; usable as the packaging
  basis for Chrome, Chromium, Edge, Brave, and Vivaldi without claiming each was
  validated.
- `dist/firefox`: MV3 non-persistent `background.scripts`, with neutral
  development ID `browser@nian-pass.local`. Publishing may replace it.

M6 invents no Chrome Web Store production ID and commits no private signing
key. M6.5 native-host packaging must resolve Chromium identity explicitly.

## Commands

```text
make browser-source-check
make browser-extension-check
pnpm --filter @nian-pass/browser-extension build
pnpm --filter @nian-pass/browser-extension package
```

The focused check performs typecheck, lint, formatting, tests, coverage, Knip,
both builds, artifact validation/secret scan, and audit. No installed browser or
GUI is required. Zip packaging is local only; no store publication or Firefox
production signing occurs.

## Manual smoke

Optional smoke should load the unpacked Chromium directory or temporary Firefox
directory against a synthetic HTTP page served on `127.0.0.1`: verify Disabled,
explicit Enable, reload and detection, then Disable and reload. Never use real
credentials or public websites. Current M6 completion evidence records both
Chromium and Firefox manual smoke separately from deterministic gates.

## Explicit non-goals

No Native Messaging, KeePassXC Browser protocol, native-host manifest, registry
entry, stdio proxy, localhost API, remote request, telemetry, storage, KDBX,
master-password form, real credential retrieval, automatic fill, or automatic
submit exists in M6. M6.5 should prefer clean-room/API-level KeePassXC Browser
protocol interoperability where practical, but no compatibility claim exists.
