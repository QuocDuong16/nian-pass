# Threat Model

This is the threat model for the M3 local vault session/filesystem foundation,
the M3.5 provider-independent merge core, the M4.2 reveal/copy desktop, the
M4.3 mutation UI, the M4.4 save/conflict flow, the M4.Q quality/security gates,
the M5.2 Android CRUD/provider-persistence flow, the M5.3 Android credential
retrieval flow, the M5.5 Android security lifecycle, and the M6.5 browser
desktop bridge. It records boundaries and assumptions; it is not a
claim that Nian Pass is ready to protect production credentials.

## M6.5 browser trust hierarchy and threats

```text
web page / DOM                  = untrusted
isolated content script         = low-trust adapter
background extension context   = privileged browser authority
native host                    = transport-only, untrusted until approval
running desktop Rust           = current vault and credential authority
```

M6.5 assumes a malicious webpage, compromised content-script input, privileged
popup confusion, stale candidate replay, navigation during a secret request,
permission revocation, native-Port reconnect, manual host launch by a same-user
attacker, a same-user local IPC attacker, desktop approval spoof/confusion,
stale `vaultSessionId`, oversized frames, stdout protocol corruption,
browser/native protocol drift, and native-host registration hijack. Exact
versioned validators, browser-owned metadata, random generations and single-use
handles, bounded framing, user-private IPC, and explicit desktop approval fail
closed across those boundaries.

Permission mutation remains at the actual popup gesture boundary. Background
provides a browser-derived canonical pattern before the click but cannot call
`permissions.request` or `permissions.remove`; permission lifecycle events then
reconcile authority. A popup-lifetime tab-change race may grant the previously
displayed host, but refresh uses the new browser-owned active tab and cannot
misrepresent that grant as authority for a different site. The pattern grants
browser site access only and is never treated as credential matching identity.

Each document has a collision-resistant random nonce and opaque field handles.
Navigation creates new authority; a stale nonce, missing handle, disconnected
node, wrong field type, disabled/readonly/hidden target, or non-top frame fails
closed. Detection observes only bounded DOM structure and never reads existing
values. Filling dispatches ordinary events and never submits. Closed shadow
roots, cross-origin frames, and ambiguous multiple login targets are explicitly
unsupported rather than guessed.

Fill delivery is accepted only on a content-initiated internal Port that
background binds to this extension's exact tab, frame, browser sender origin,
current permission, and document nonce. Popup/options pages cannot impersonate
that sender merely by knowing the Port name. Duplicate documents replace the
old binding; disconnect and navigation remove it. If service-worker state is
lost, content may reconnect once, and no credential is delivered until authority
is reconstructed. No secret queue exists, and content still rejects a stale
nonce or handle as defense in depth.

The popup uses fixed local HTML and `textContent`, shows generic state and
secret-free candidate summaries, and never receives a password. There is no
telemetry, network API, extension storage, persistent pairing, localhost server,
browser KDBX parser, or browser master-password form.

Candidate handles bind tab, top frame, exact origin, document nonce, field
handles, native generation, and `vaultSessionId`, and are consumed before the
secret request. Navigation, origin change, permission removal, Port replacement,
native reconnect, or vault replacement invalidates them. Background repeats
the complete browser check after the native response; stale responses are
dropped without DOM mutation. Unknown, stale, duplicate, or timed-out request
IDs cannot complete another request, and credentials are never queued for retry.

The same OS user is not trusted as browser authorization. Every IPC stream
requires a generic desktop Allow/Deny decision within a monotonic timeout; no UI
means deny, and authority ends with that stream. The native host never opens
KDBX or owns `VaultSession`. Current `DesktopVaultService`, random session
identity, current `EntryId`, and Rust exact-origin matching remain the final
secret authority. Connection approval does not imply an unlocked vault.

Browser-bridge startup denial of service includes an unsafe runtime directory,
a live endpoint conflict, and non-socket garbage at the expected endpoint.
These conditions never weaken IPC checks or authorize unlinking a live owner:
the bridge becomes unavailable for that process while the desktop vault remains
usable. Browser integration can recover on the next explicit desktop start.
Native-host registration also treats manifest/registry divergence, partial
install or uninstall, and rollback failure as threats. Bounded prior-state
capture and exact two-resource rollback restore the Nian Pass-owned state; an
unverified rollback fails with transaction uncertainty and never reports
success or erases unrelated HKCU values.

Residual threats remain: M6.5 cannot protect against a fully compromised OS,
root/Administrator, sufficiently privileged process-memory inspection, a
malicious browser itself, native-host registration changed with equivalent
privilege, or a user approving a fraudulent same-user request. Explicit
approval mitigates silent same-user connection abuse but cannot cure a
compromised machine. JavaScript strings cannot be reliably zeroized, so the
implementation minimizes lifetime and references without claiming secure erase.

## Secret material

Secret material includes at least:

- Master passwords
- Database decryption keys, including derived keys
- Entry passwords
- Entry notes, which may contain recovery codes, API keys, or private text
- TOTP seeds
- Protected and unprotected custom-field values, either of which may contain
  credentials, recovery material, or private account identifiers
- Key-file contents
- Recovery secrets

Secret material must never be intentionally written to logs, telemetry, crash
reports, remote diagnostics, or normal CLI output.

## Privacy-sensitive vault metadata

Privacy-sensitive vault metadata includes at least:

- Entry titles
- Group names
- URLs
- Usernames
- Custom-field names
- Entry and group identifiers
- Database paths
- Vault names

These values are not necessarily secret cryptographic material, but they can
reveal accounts, organizations, finances, health services, or other private
context. Privacy-sensitive vault metadata must not be written to application
logs, telemetry, crash reports, or remote diagnostics by default.

The explicit `list` CLI command may print group names and entry titles because
the user directly requested that output. This is command output, not
application logging or telemetry. Terminal control characters are sanitized
before display, and a protected Title is rendered only as the fixed
`[protected]` marker rather than being revealed.

Encrypted database files, attachments, and key files are also security assets.
Their ciphertext, size, location, and modification times can expose useful
information to an attacker even when their plaintext remains unavailable.

## Threats

- Local malware and a compromised unlocked process
- Stolen or unattended devices
- Clipboard snooping
- Memory dumps and swap or crash artifacts
- Cloud provider compromise
- Future sync server compromise
- Malicious browser extensions
- Accidental sensitive logging or diagnostic output
- Database corruption and partial writes
- Power loss or disk exhaustion during save
- Filesystem and cloud-storage replacement semantics
- Concurrent writes and unresolved conflicts
- Writer serialization bugs
- Silent protected/unprotected field-state changes during mutation
- Protected KDBX metadata downgraded into ordinary clonable application strings
- Silent KDBX version downgrade or upgrade
- Silent KDF, cipher, or compression changes
- Data loss caused by reconstructing a database from an incomplete projection
- Compromised supply-chain dependencies
- Interoperability failures hidden by parser/writer self-roundtrips
- External compatibility commands hanging or failing non-interactively
- Compatibility-test credential or decrypted-content leakage
- Plaintext exposure through compatibility-test temporary files
- Accidental permanent deletion when a caller expected recycle-bin behavior
- Missing or incorrect deleted-object tombstones that break future sync
- Recursive group deletion that silently leaves or loses descendants
- Invalid group moves that create hierarchy cycles
- Custom-field values copied into bulk projections or diagnostics
- Standard, TOTP, or passkey fields mutated through a generic custom-field API
- Silent file-level last-writer-wins during synchronization
- An incorrect common BASE causing invalid change classification
- Deletion resurrection when absence is mistaken for an unchanged object
- Delete-versus-modify data loss
- Concurrent password edits resolved by timestamps
- Concurrent group moves producing cycles or an invalid root
- Attachment, history, custom-icon, or metadata loss during synthesis
- Root metadata silently ignored during divergent synthesis
- Sibling reorder silently discarded when the other branch changes membership
- Cross-generation historical attachment references bound to the wrong binary
- An invalid synthesized candidate escaping partial hierarchy checks
- Secret plaintext or custom-field values exposed by conflict diagnostics
- Malformed or drifted IPC data reaching React state
- Browser persistence retaining master-password, vault, or session state
- Direct Tauri IPC calls bypassing the reviewed desktop adapter
- Remote assets, permissive CSP, or new Tauri capabilities widening the WebView
- Render failures producing a blank screen or exposing raw exception text
- A copy-versus-Lock race writing a vault secret after Lock completes
- External clipboard replacement between ownership verification and clear
- Secret-bearing edit drafts lingering in the WebView
- Partial multi-field edits or multiple history snapshots for one Apply
- Dirty in-memory edits silently discarded by Lock or window close
- Mutation-versus-Lock races and stale selected IDs after structural changes
- Protected custom fields accidentally downgraded during value updates
- Mutation responses returning passwords, notes, or custom-field values
- A stale external KDBX generation overwritten by desktop Save
- A master password retained to make repeated Save convenient
- Wrong Save credentials modifying or re-keying the source
- Frontend optimism clearing dirty state before persistence commits
- Save responses exposing credentials, paths, backup names, or fingerprints
- Reload failure destroying the dirty local in-memory session
- Save-and-Lock locking, or Save-and-Close closing, after Save failure
- A window close silently terminating an active persistence transaction
- A successful Save failing to update the source fingerprint baseline
- A force-overwrite path bypassing external-change protection
- An unlocked vault left visible or accessible after user inactivity
- Revealed plaintext remaining visible after the window loses foreground focus
- Background WebView timer throttling extending an unlocked interval
- Idle handling silently discarding Rust dirty state or frontend-only drafts
- A visual privacy shield being misrepresented as backend Lock or screenshot prevention
- Blur clearing the clipboard before the user can paste into another application
- Manual Lock and idle expiry issuing duplicate backend Lock requests
- Auto-lock bypassing Save failure or external-conflict UX
- Native Kotlin/Swift code duplicating cryptographic, KDBX, or persistence logic
- Broad mobile Tauri capabilities exposing filesystem, shell, process, or network access
- Generated mobile defaults granting production network authority before Nian Pass has a production network feature
- Android content URIs being treated as ordinary canonical filesystem paths
- URI/provider/document identifiers leaking to the WebView, logs, or errors
- Partial or stale encrypted import files remaining in private staging
- An Android staging copy being treated as a canonical Save target
- Mobile Save, mutation, or secret reveal being exposed before source semantics exist
- URI grants being retained beyond the immediate staging copy
- Platform bootstrap leaking device or environment identifiers
- Mobile signing keys or signing passwords entering version control
- A mobile development server being exposed outside its required development boundary
- A Linux build being misreported as iOS validation
- A fake Android application reusing a legitimate package name
- An Android package signing key changing after trust establishment
- A malicious or unverified browser/WebView target claiming a web domain
- A privileged browser origin failing verification and being downgraded to the browser package
- The browser package becoming a confused deputy for arbitrary web origins
- Process death between an AuthenticationAction and its credential Activity
- A stale credential request, replayed PendingIntent, or reused request token
- A sequential PendingIntent request code aliasing after process restart
- A `singleTop` credential Activity continuing to use its stale prior Intent
- A deleted entry being fulfilled from stale candidate metadata
- Password plaintext crossing WebView IPC or being cached by Kotlin
- AssistStructure form contents being logged or persisted
- Source URI and trust metadata leaking from native storage or backups
- A corrupted bookmark, missing/invalidation Keystore key, or wrong AEAD context
- A cold service process treating a remembered source as an unlocked vault
- A remembered Autofill source retaining WRITE after normal Lock
- Autofill fulfillment racing Lock and returning a secret after Lock authority ends
- Accidental master-password or KDBX derived-key persistence in Android Keystore
- A Recents snapshot or screen capture exposing the vault
- A stale WebView frame appearing briefly before resume reconciliation
- WebView suspension preventing a JavaScript timeout from firing
- Wall-clock or timezone rollback extending a security deadline
- Dirty decrypted state remaining in process memory while shielded
- Android process death losing unsaved in-memory mutations or drafts
- Backgrounding during unlock, Save, mutation, or two-phase Lock
- A stale lifecycle generation uncovering a newer privacy curtain
- CredentialActivity background/replay releasing a secret to stale authority

## M4.Q desktop and repository controls

Production frontend code cannot use browser storage/cookies/cache APIs,
`eval`, `Function`, `document.write`, `dangerouslySetInnerHTML`, console output,
or runtime HTTP(S) assets. Only the reviewed platform adapters
`src/lib/desktop.ts` and `src/lib/mobile.ts` may import Tauri core or invoke
commands. Runtime IPC data is reconstructed through exact-key validators
before use; malformed snapshots and unknown enum values fail closed as a
generic internal error. The application-level ErrorBoundary renders fixed
recovery guidance without the exception message, stack, props, state, or
logging.

Tauri capability JSON is held to `core:default`. The current Rust plugin
allowlist is Tauri core plus dialog and the official clipboard-manager plugin
only inside `apps/desktop/src-tauri`; filesystem, shell, HTTP, process, updater,
and every other clipboard plugin remain rejected. The JavaScript clipboard
plugin and browser clipboard APIs are forbidden, and the WebView receives no
clipboard permission. CSP is parsed and rejects wildcard default, script, or
connect sources, `unsafe-eval`, and arbitrary HTTPS connections.
The existing `style-src 'unsafe-inline'` remains a narrow styling requirement;
it does not permit script execution and is tracked in the quality policy.

Rust advisory, license, source, duplicate-version, and unused-dependency policy
is machine checked. npm production dependencies are audited separately from
dev-only tooling. Coverage is a regression guard, not proof of security; exact
DTO whitelist and state-transition assertions remain required.

## M5.2 Android provider persistence controls

The URI, provider identity, persisted-grant state, backup paths, journal, and
opaque source-token map remain native app-private data. React receives only a
sanitized filename and semantic writable boolean; it cannot invoke the native
plugin or submit a URI/path/token. Unknown source tokens fail generically.
Persistable access requests are limited to document read/write flags actually
granted by Android. Clean Lock/source replacement releases the grant; unresolved
recovery retains it. No storage/media permission, `FileProvider`, `_data`,
`Uri.getPath`, release `INTERNET`, cloud API, or HTTP dependency is introduced.

Rust `MobileVaultSession` owns the complete `KdbxDocument`, encrypted SHA-256 +
size baseline, and saved revision. Kotlin never parses or serializes KDBX.
Mutations call the authoritative KDBX APIs and remain memory-only until explicit
Save. Existing passwords are not preloaded; narrow edit loads are component
local and failure cannot become an empty overwrite. Save and reload credentials
clear before await and become `SecretString`; no credential is retained.

Before provider mutation, Rust proves the full staged provider generation still
equals the unlock baseline, proves the credential opens it, serializes the dirty
document to an opaque no-backup candidate, syncs it, reopens it, verifies KDBX
semantic equivalence, and fingerprints the exact ciphertext. Kotlin verifies
that candidate path belongs to the registered transaction directory, creates
and syncs an exact encrypted baseline backup, writes an `AtomicFile` journal as
`PREPARED`, performs another full provider baseline check, then durably advances
the journal to `WRITE_STARTED` before opening the destructive `rwt` descriptor.

A write return is never Save success. Kotlin stages the complete provider
read-back and requires the exact candidate generation. Rust then reopens that
read-back with the Save credential and verifies semantic equivalence. Only this
point advances the Rust baseline/saved revision and may make dirty false. A
verified rollback requires complete provider read-back equal to the original
baseline. Unverified rollback, final mismatch/read failure, or transport
ambiguity returns `save_uncertain` and preserves required backup/candidate/
journal data. No Save error continues pending Lock intent.

At startup cleanup and reselection, only Nian Pass journals are inspected.
Current provider bytes equal to baseline or candidate are known outcomes and may
be reconciled without overwriting. Unknown bytes, malformed journals, or an
unreadable ambiguous source return `recovery_required`; timestamps, sizes alone,
provider names, and journal age never choose a winner. There is no force-save,
last-writer-wins, automatic M3.5 merge, sibling `.bak`, autosave, or background
write.

Generic SAF does not promise atomic replace, remote durability, or a conditional
compare-and-swap. There remains a cooperative-writer race between final baseline
check and destructive provider write. Exact final read-back detects candidate
loss/corruption and many following races, but cannot prove another writer did not
briefly commit and get overwritten before Nian Pass wrote. Nian Pass makes no
generic provider atomicity/fsync claim; providers lacking persistent writable
capability are explicitly read-only (`persistence_unsupported`).

Dirty ordinary Lock returns `unsaved_changes`; only explicit discard-and-lock
drops dirty state without writing. Save/Reload/selection/Lock and mutations share
one operation boundary and revision token, preventing stale async completion from
marking a newer revision clean. Frontend drafts disable Save. General mobile
Reveal/Copy, credential retrieval, Keystore metadata, biometrics, sync, iOS
persistence, and production mobile hardening remain outside M5.2. M5.3 adds only
the credential retrieval and metadata protection described below. iOS is NOT RUN on Linux; initialization,
build, and validation require macOS with Xcode.

Mobile Lock is a two-phase transaction: Rust reserves the shared operation and
retains the decrypted session while native code releases the Android source;
only completion of that exact operation may then drop the session. Failed clean
Lock release leaves the session clean and unlocked. Failed dirty discard release
leaves the original dirty session unlocked. If Save succeeded before a
Save-and-Lock release failure, the Save is not rolled back and the session stays
clean and unlocked. These failure states intentionally keep backend and frontend
truthful without reacquiring or reconstructing the source document.

## M5.3 Android credential retrieval controls

Credential Manager and AutofillService are framework-bound exported services,
protected respectively by `BIND_CREDENTIAL_PROVIDER_SERVICE` and
`BIND_AUTOFILL_SERVICE`; they are not generic exported command endpoints. Their
authentication PendingIntents explicitly target Nian Pass, contain only random
opaque tokens, and use mutable semantics only where Android must attach result
data. The credential Activity is private, excluded from recents, and uses
`FLAG_SECURE`. No accessibility service, overlay, broad package query, storage
permission, release `INTERNET`, or network-backed association lookup is added.

Native parsing reads only the requesting package, current SHA-256 signing
certificate identity, AndroidX-verified Credential Manager origin, recognized username/email/password
classifications, and required AutofillIds. It never logs or persists an
AssistStructure or input-node text. Package name alone never authorizes silent
release: the exact package association must match in Rust and the native trust
store must contain the same certificate pin. A missing pin or changed signing
identity requires explicit confirmation. Web URL matching uses a real parser and
exact canonical host; an unverified web association always requires intentional
approval and cannot silently downgrade because network verification is absent.
For a populated Credential Manager origin, the bundled privileged-browser
allowlist and `CallingAppInfo.getOrigin()` must validate the exact browser
package/certificate identity. Failure is unavailable, not APP fallback, so a
browser cannot act as a confused deputy for every site. Only strict HTTPS origin
syntax is accepted and exact canonical host matching remains Rust-owned.

The native registry is process-local, expiring, and single-use. Its records and
candidate mappings are cleared on completion, cancellation, expiry, and Lock
where possible, and never written to disk. It is only a cache: after process
death the private Activity reconstructs the begin/final Credential Manager
request using `PendingIntentHandler`, or classic Autofill using Android's
`EXTRA_ASSIST_STRUCTURE`, and fully revalidates the native target before issuing
fresh tokens. A stale custom token without framework authority fails. Random
data-URI PendingIntent identity does not reset with the process, and retained
`singleTop` handling replaces `getIntent()` state and retires the prior request.
Rust computes secret-free candidates from
the current unlocked `KdbxDocument`; protected Title/UserName stay protected in
bulk DTOs. Final approval revalidates the active request, target match, session,
and current stable entry ID under the shared operation reservation. Deletion,
mutation mismatch, replay, and Lock all fail as credential unavailable. Dirty
in-memory credentials may be read because that Rust document is authoritative,
but Autofill never calls Save or clears dirty state.

Only after final validation does Rust narrowly read the current username and
password and invoke the backend-only native bridge. React cannot invoke the
native fulfillment method and never receives a password, protected custom value,
AutofillId, AssistStructure, certificate, URI, or framework Parcelable. Kotlin
uses the returned password only to build the one-use framework response; it has
no singleton/global password field, SharedPreferences secret, Bundle secret,
saved-state secret, shadow vault, or persisted vault index. Java/Kotlin strings
cannot promise secure erasure, so the control is narrow lifetime rather than a
false zeroization claim.

The source bookmark and per-source package trust associations are a versioned
metadata record encrypted by a non-exportable Android Keystore AES-256-GCM key
with a fresh IV and stable purpose-specific AAD. Only ciphertext and IV are
atomically stored below `noBackupFilesDir`. The key has
`setUserAuthenticationRequired(false)` because M5.3 protects metadata at rest,
not KDBX unlock material. It stores no master password and no KDBX derived key.
Missing/invalidated keys, modified IV/ciphertext, AEAD
failure, malformed payload, and unknown schema fail closed without exposing the
URI or crypto exception. Re-enabling Autofill is required.

Enabling source remembering is an explicit transaction over an already unlocked
source and a valid persisted SAF READ grant. A live normal session may retain
READ + WRITE until Lock so M5.2 Save remains usable. Lock still drops the
complete Rust session and decrypted document only after native code releases
WRITE alone and verifies persisted READ=yes, WRITE=no. A failed release aborts
the existing two-phase Lock, preserving the Rust session. The bookmark stores
READ only, legacy flags normalize to READ, and cold rehydration is never
writable. Disable removes bookmark and trust
metadata and releases the grant when no live source still needs the existing
two-phase Lock handoff. The bookmark contains no master password, entry password,
KDBX document key, manually derived/composite key, biometric quick-unlock
material, or full vault index. Cold rehydration stages a fresh encrypted
generation and still requires the normal master-password unlock.

Credential creation/import, Autofill SaveRequest mutation, passkeys, TOTP
autofill, biometric/device-credential quick unlock, derived unlock material,
sync, and Apple platforms remain outside M5.3. M5.5 adds the Android lifecycle
controls below without changing M5.3 matching or fulfillment. Native Apple work is intentionally
deferred to M9+ while the existing M5.4 Rust/shared foundation is retained.

## M5.5 Android lifecycle controls and limitations

Every Nian Pass Android Activity that can render sensitive content applies
`FLAG_SECURE`; API 33+ also disables Recents screenshots. These controls reduce
ordinary screenshots, screen recording, and app-switcher snapshot exposure.
They do not defeat root, malware with process access, a compromised OS, a
physical camera, every OEM bug, or an attacker who already observed plaintext
while the device and vault were legitimately unlocked.

Activity pause/focus loss atomically invalidates that exact Activity's prior
lifecycle generation and attaches its opaque native privacy curtain before the
WebView is trusted to redraw. Process foreground and device screen state are
global, while resumed/focused state, generation, and curtain authority are held
in a weak per-Activity registry. A global process/screen transition invalidates
all attached authorities; an Activity-local transition does not corrupt another
Activity. `MainActivity` and `CredentialActivity` therefore cannot authorize
one another's curtain. The curtain has only a generic accessible label and makes
covered WebView descendants inaccessible. It is intentionally distinct from
backend Lock: it prevents display and interaction while the native/React/Rust
state is reconciled, whereas successful Lock drops the decrypted Rust session.
Only an acknowledgement for the exact attached caller Activity's current
generation while it is resumed and focused, the process is foreground, and the
device is interactive and unlocked removes that Activity's curtain.
`ProcessLifecycleOwner` remains a secondary process-state signal; its delayed
stop callback is never relied upon to invalidate Activity confidentiality.
Rotation creates a newly covered Activity; detached authority cannot be
acknowledged. Stale callbacks, Back, returning
from a document picker or Settings, multi-window focus changes, and external
intents cannot implicitly continue editing or reveal the vault. PiP,
AccessibilityService detection, overlay permissions, notifications, and a
foreground service are not used.

Screen classification first checks `PowerManager.isInteractive`: every
non-interactive state is `SCREEN_OFF` regardless of Keyguard. Only an
interactive device uses `KeyguardManager.isDeviceLocked` to distinguish
`DEVICE_LOCKED` from `ACTIVE`. All screen broadcasts converge on this classifier.

Elapsed-time policy uses Android `SystemClock.elapsedRealtime`, Rust `Instant`
where the backend serializes work, and frontend `performance.now`; it never uses
wall clock. Resume reanchors against Android monotonic time, so a suspended
WebView timer, timezone change, or wall-clock rollback does not extend the
deadline. Foreground inactivity defaults to five minutes and is configurable
only in process-level React memory. It survives Lock/unlock and source selection
inside the same running process and resets to five minutes only when a new app
process/application root starts. Never disables only foreground inactivity;
native background/screen protection and clean Lock still apply.

For a clean vault, background, screen-off/device-lock classification, or idle
expiry requests the existing two-phase Rust Lock. The privacy curtain remains
until native source release and exact Rust operation completion have succeeded.
If a mutation, Save, or Lock operation is already serialized, lifecycle does
not interrupt a provider write, start a second Save, discard, or expose stale
success. It waits shielded and reconciles the authoritative result. A native
source-release failure cancels the exact Lock operation, retains the Rust
session, and exposes only a generic retry state after safe resume.

Security attention supersedes normal Save/reload/conflict dialogs structurally,
so a pre-background form cannot remain keyboard- or accessibility-reachable.
Its password is cleared and non-running dialog state is closed. In-flight
provider Save/reload operations are not cancelled: their UI remains suppressed,
their single operation finishes, and the actual Rust/native result is reconciled
behind the shield. Save and lock chosen from dirty security attention starts a
fresh empty credential prompt without uncovering vault content.

For a dirty Rust session or frontend draft, the same transitions immediately
hide sensitive UI but never autosave or discard. Resume requires an explicit
draft decision first and then, where needed, Save and lock, Discard changes and
lock, or Continue editing. Save still requires the real master password. The
residual tradeoff is honest: a dirty decrypted `KdbxDocument` and plaintext
draft may remain in process memory until the user resolves it or Android kills
the process. Process death destroys that in-memory state and can lose unsaved
work. Persisting decrypted crash state would create a worse plaintext recovery
asset, so M5.5 does not do it.

Unlock and Save password inputs are cleared on a security transition. Secret
draft fields are not visible or accessibility-reachable behind the curtain but stay only
in component/process memory for the explicit decision. No lifecycle DTO or
production lifecycle log carries a filename, source URI, entry ID, title,
username, password, draft content, certificate, request data, or generation
fingerprint.

CredentialActivity applies the same secure-window and Recents policy. If it
pauses before fulfillment, it clears custom Intent authority, retires the
single-use registry request, clears the React-owned password through the normal
lifecycle shield, cancels the result, and finishes. An exactly-once completion
gate prevents pause/destroy from double-completing a successful, cancelled, or
failed request, while `onNewIntent` installs new authority only after retiring
the old request. M5.3 package/certificate, verified browser-origin, exact-host,
and stable EntryId final checks remain unchanged.

Biometric quick unlock remains unsupported. The KDBX boundary has no reviewed
reusable non-password unlock-material abstraction that opens the same KDBX and
can be invalidated and wrapped by Android Keystore authentication. M5.5 never
persists the master password, an encrypted master password, password-equivalent
string, KDBX derived key, decrypted XML, or decrypted database. The M5.3
metadata key uses `setUserAuthenticationRequired(false)` for a distinct
source-bookmark purpose and is never reused as an unlock key.

## M4.3 mutation controls

Desktop mutation commands accept stable IDs and semantic request types only.
One atomic entry update prevalidates before a single tracked edit, so failure
cannot leave a partially updated entry and one Apply produces one history
snapshot/revision. Fresh secret-free snapshots replace React state after Rust
success; no optimistic tree mutation occurs. Existing custom fields preserve
their protection state, new custom fields default protected in the UI, and the
adapter remains authoritative for reserved names.

Existing custom-field edits fail closed until the exact value has loaded:
load failure cannot be converted into an empty-string mutation, while a
successfully loaded empty string remains a valid value. Retry uses the same
generation-guarded loader. Existing empty and whitespace-only names remain
manageable by exact identity, while the ordinary new-field UI rejects blank
names. Creation receipts must name an entry/group contained in their returned
snapshot, preventing stale post-create selection.

Password editing never preloads the existing password. Notes, custom values,
and protected metadata require explicit narrow loads. Drafts are component-local
and clear on Apply, Cancel, failure, navigation, Lock, and unmount; browser
persistence and logging remain forbidden. Mutation receipts and bulk/detail
DTOs carry no password, notes, or custom value.
Failed Notes loads display a generic alert and leave Notes absent from an entry
update request, so unrelated metadata may still be applied safely.

Rust is authoritative for dirty state. Plain Lock refuses dirty sessions and
does not drop them; explicit discard-lock shares the Copy/Lock lifecycle gate,
drops the session before best-effort clipboard cleanup, and never saves. Window
close calls a testable Rust policy and is prevented for dirty sessions until
explicit discard. Permanent entry and recursive group deletion use explicit
warnings and remain tombstone-based, not recycle-bin operations. Service tests
verify mutation/discard leaves the immutable source fixture byte-identical.

## M4.4 save and reload controls

Desktop Save is explicit and is the only desktop disk-write command. The
WebView supplies one component-local password string, the command immediately
moves it into `SecretString`, and the service calls `VaultSession::save`; no
layer retains the password for another operation. React clears its password
state before awaiting Save/reload and again on Cancel or transition. JavaScript
strings still cannot be deterministically zeroized.

M3 revalidates the encrypted fingerprint at actual Save execution, including
when an external editor changes the file after the credential dialog opened.
Fingerprint mismatch, source deletion, or unsupported path maps to the stable
`external_change` code without paths or digest data. There is no force-save,
ignore-fingerprint, overwrite-anyway, autosave, or automatic M3.5 merge command.
Before replacement, the external bytes and local dirty session are both
retained. `FinalExternalModificationDetected` also maps to `external_change`,
but only claims that another writer changed the target after Nian Pass installed
its candidate; it does not claim that Nian Pass never modified the primary.

Successful Save returns a newly projected Rust snapshot and the frontend
accepts it only when exact-key runtime validation proves `dirty=false`. Ordinary
pre-commit Save failure leaves the session dirty and never shows Saved.
Post-commit final read/verification and durability/backup uncertainty map to
`save_uncertain`: the frontend requests a fresh Rust snapshot, shows a final
on-disk verification warning, and never continues a pending Lock or close
intent. The refreshed session may be dirty or clean depending on how far M3
reconciled the canonical baseline; the frontend does not infer dirty state from
the presence of an error and never shows Saved for uncertainty.

Destructive reload opens and projects the current canonical file into a
candidate session before swapping it into service state. Wrong credentials,
invalid KDBX bytes, or a missing source cannot drop the existing dirty session.
Successful reload remounts the presentation so stale selections, reveals, and
drafts do not survive the external generation change.

Save holds only the desktop service mutex during M3 persistence. Mutations and
Lock cannot interleave; Save never acquires the Copy/Lock lifecycle gate, so it
cannot introduce the inverse `service -> secret-operation gate` order. While
Save is pending, React disables mutation and Lock actions and synchronously
prevents close requests. Dirty Lock/close offers Save, explicit discard, or
Cancel. Ordinary Lock and native close execute only after Save returns a clean
snapshot. Any Save error or external conflict keeps the application open and
never automatically continues pending Lock or close. Pre-commit failures and
ordinary external conflicts leave the local session dirty; some post-commit
uncertainty states may already have a clean Rust session, which the frontend
reflects only after refreshing the canonical snapshot.

## M4.5 inactivity and privacy controls

The inactivity manager records only genuine pointer, keyboard, touch, wheel,
and non-expired focus-return activity. It resets one timer/ref rather than
placing timestamps in React state, and stores the selected fixed timeout only in
application memory. Clean timeout uses ordinary `lock_vault`, which drops the
Rust session and reuses conditional clipboard cleanup. Never disables only
inactivity Lock; privacy-on-blur and manual Lock remain active.

Blur replaces the sensitive UI with a neutral privacy shield and clears
reveal-only password/notes state. It deliberately does not clear the clipboard,
because switching to a target application is the expected copy/paste flow.
Focus restores content only if the absolute elapsed-time check is still below
the deadline; otherwise clean state locks or dirty/draft state remains
shielded. This mitigates throttled WebView timers but does not claim exact timer
wakeups. Foreground state is owned by the actual window lifecycle, which is
tracked while Locked and Unlocked and initialized through the narrow Tauri
adapter's current-focus query. Generic activity and asynchronous Save or Unlock
completion cannot clear a background privacy shield. This prevents a pending
Unlock from exposing newly decrypted content after a background transition.

Rust dirty state and frontend-only drafts are independent safety signals. A
dirty timeout never calls `discard_changes_and_lock` automatically. It offers
Save and lock, explicit Discard changes and lock, or Continue editing. Backend
`unsaved_changes` overrides a stale clean frontend view and enters the same
decision without retry. Save failure, `save_uncertain`, and external conflict
never continue to Lock. An unfinished frontend edit cannot be saved by M4.4;
the user must return to it or explicitly discard it before security handling
continues. Pending mutation/Save/reload operations defer the competing Lock
decision, and successful explicit Save establishes new user activity.

The privacy shield is not called Locked. While dirty-idle attention is active,
the decrypted Rust `VaultSession` remains unlocked until explicit Save or
discard. The shield reduces casual window/app-switcher preview exposure but is
not universal screenshot prevention, secure re-authentication, process-memory
encryption, or protection against endpoint malware. M4.5 adds no unsafe native
screenshot hooks, retained credentials, browser persistence, force-lock,
autosave, or new Tauri permission/plugin.

## Security assumptions

- Nian Pass cannot fully protect a vault when endpoint malware controls the
  process or device while the vault is unlocked.
- Encryption at rest does not protect data already decrypted inside a
  compromised unlocked process.
- A future server must remain zero-knowledge with respect to vault content and
  must never receive master passwords or vault decryption keys.
- Operating-system access controls, secure update delivery, and the security of
  cryptographic dependencies remain part of the trusted computing base.
- Backups and remote storage may observe encrypted database bytes and metadata
  such as size and modification time.

## Retained M2.5 controls

The CLI reads the master password from an interactive terminal without echo and
does not accept a password argument. Its input buffer is cleared on drop, and
the adapter returns generic credential and format errors without embedding the
password. The bulk domain projection exposes privacy-sensitive visible title,
username, URL, tags, and identifiers plus password/notes presence flags, but
excludes protected Title/UserName/URL plaintext, password and notes plaintext,
TOTP seeds, attachment contents, history, and all custom-field values. Protected
standard metadata maps to an opaque `SummaryText::Protected` state, and the
adapter checks protection before copying any visible text into the projection.

Password and notes reads require an exact `EntryId` and return one owned
`SecretString`. Its backing `String` is zeroized on drop through `zeroize`; the
type intentionally has no `Debug`, `Display`, `Clone`, serialization, deref, or
implicit string-borrowing implementation. Callers must explicitly invoke
`expose_secret()` for the shortest practical lifetime. The adapter makes one
owned copy from the decrypted dependency representation into `SecretString` and
does not place secrets in errors or logs.

Custom-field enumeration returns `CustomFieldSummary` values containing only a
privacy-sensitive name and protection state. Even an unprotected custom value
requires an explicit entry UUID plus field name and returns `SecretString`.
Generic custom-field APIs reject the five standard fields, supported legacy and
current TOTP storage names, and KeePassXC passkey attribute names. Existing
custom fields retain their protected/unprotected mode on update, while callers
must select protection for new fields. Add, update, and delete operations retain
the prior field state in entry history; same-value updates and deletion of a
missing custom field do not change history or timestamps.

Zeroization reduces accidental residual memory but cannot guarantee removal of
copies made by the operating system, swap, allocator, runtime, compiler, or
dependencies. A compromised process while the vault is unlocked can still read
decrypted dependency state and any explicitly exposed secret.

M3.5 itself does not address clipboard access, locked-memory allocation, process
hardening, cloud transport/provider behavior, base-generation storage, or
dependency attestation. M4.2 adds bounded Rust-owned active-clipboard handling,
but it does not eliminate clipboard snooping/history or the other threats in
that list.

M2.5 confines experimental mutation to an opaque `KdbxDocument` retaining the
complete `keepass-rs` representation. It never serializes from the incomplete
`Vault` projection, never stores the master password, and looks entries up by
UUID. Title, username, URL, and password edits preserve existing field
protection. For missing non-empty Title, UserName, and URL fields, database
memory-protection policy selects the new field state; absent policy metadata
falls back to unprotected. Missing non-empty password fields remain protected
regardless of database policy. Same-value and missing-plus-empty requests avoid
history, timestamp, and representation changes. Typed errors for unknown entries, unsupported write formats,
destination I/O failure, and serialization failure do not contain identifiers,
metadata, or secrets. KDBX 3.1 and 4.0 writes are rejected. The lower-level
adapter save API still accepts only a caller-owned writer; the M3 path-owning
transaction is isolated in `vault-session`.

All entry and group mutations use stable UUID identities. Entry and group moves
validate their complete source and destination before mutation; group moves
reject root, self, and descendant targets. Same-parent moves and same-name group
renames are complete no-ops. Projections remain immutable snapshots, so a fresh
projection is required to observe document changes.

Permanent deletion is named explicitly and is separate from KeePassXC's
user-facing recycle-bin policy. Entry deletion creates a timestamped tombstone.
Recursive group deletion tombstones the parent, every nested group, and every
contained entry, matching KeePassXC 2.7.12 deletion tests; it also clears
represented custom-icon back-references and metadata UUID pointers before
removal. Root deletion is rejected. Tests verify unknown and invalid operations
leave the complete database unchanged and verify all tombstones after
save/reopen.

Tests serialize to memory, reopen the result, verify preservation invariants,
exercise wrong credentials and writer failure, and confirm the source fixture
bytes remain unchanged. CI verifies every committed fixture against
`fixtures/kdbx/SHA256SUMS` before running tests.

`keepass-rs` cannot preserve fields it does not parse, so neither self-roundtrip
nor external verification is a claim of universal lossless KDBX preservation.

## M3 filesystem threats and controls

M3 explicitly considers process crash during save, power loss, disk full, temp
serialization failure, a wrong password supplied to ordinary save, external
editors changing the vault before or during save, stale-source overwrite,
unsafe Windows delete-then-rename behavior, partial/corrupt backup writes,
destination DACL loss during Windows temp replacement, a failed attempt
advancing the recovery generation, post-verification path replacement being
accepted as a new baseline, symlink/path substitution, and silently discarded
dirty sessions.

Controls are:

- The primary is never opened with truncate and is never removed before a
  complete verified same-directory replacement exists.
- Complete encrypted bytes are streamed through SHA-256 during stable open and
  before save. Save checks the primary before credential validation, again
  after temp semantic verification, and once more after backup preparation.
- Ordinary save authenticates its supplied `SecretString` against the unchanged
  current source. A typo returns `CredentialMismatch` before temp or backup
  creation and cannot become accidental master-password rotation.
- Random opaque save and backup temps use exclusive creation in the target
  directory. Buffered output is explicitly flushed and each prepared file is
  synced before commit.
- The serialized temp must reopen with the credential and match the in-memory
  document's exact version and complete parsed `Database` semantics. The final
  installed primary undergoes the same semantic check through a stable-open
  helper. Its accepted fingerprint comes from the exact handle generation that
  was hashed, parsed, hashed again, and matched to the current path.
- Exactly one previous-version backup is copied from source ciphertext through
  its own verified temp. It is committed only after the new primary is installed
  and verified, so failed pre-primary saves retain the previous successful
  recovery generation. A post-primary backup commit failure leaves the verified
  primary/session clean and returns `SavedButBackupUpdateFailed`; recovery is
  never automatic.
- All namespace replacement goes through one platform helper. There is no
  delete-destination-then-rename or unsafe direct-write fallback. Unix syncs the
  parent directory after primary and backup replacement. Windows dirty save
  fails closed with `UnsupportedPersistencePlatform` until security-preserving
  replacement is available under the workspace's safe-Rust policy.
- If primary replacement succeeds but parent-directory sync fails, the final
  target is inspected and the session baseline is reconciled before returning
  `DurabilityUncertain`; this is not reported as a pre-commit failure.
- Revision-based dirty tracking is automatic for all public document mutations.
  No-op and failed operations stay clean, successful logical mutations increment
  once, a mutation after numeric saturation sets a sticky permanently-dirty
  state, `save_to_writer` cannot clear dirty state, and drop never autosaves.
- Final-component symlinks and all non-regular sources are rejected. A backup
  symlink is also rejected immediately before replacement.

Fault-injection tests cover every named pre-replacement phase, serialization
failure, temp verification failure, final-generation replacement, primary
replacement failure, pre-existing backup preservation, post-primary backup
failure, post-replacement handling, and directory-sync uncertainty. They assert
exact source/backup byte preservation, dirty revision retention, and
transaction-temp cleanup where applicable.

## M3.5 merge threats and controls

M3.5 requires the caller to supply the last generation known common to both
sides. Selecting that BASE correctly remains a future provider/application
responsibility. The engine never infers BASE from mtime, file size, ciphertext,
or a newer-looking object timestamp.

Controls are:

- Entry and group UUIDs are identity; titles, names, paths, and ordering indexes
  are never identity.
- Changes are classified independently against BASE. Entry fields compare both
  plaintext semantics and protected/unprotected state inside the sealed KDBX
  adapter.
- Deletion requires represented `DeletedObjects` state. Concurrent
  delete-versus-modify is an explicit conflict rather than deletion or
  resurrection.
- Different changes to independent fields or to location versus content can be
  combined. Different edits to one field and different moves conflict.
- Group-subtree deletion checks descendants. Root identity/location remain
  immutable while root metadata and child order participate in merge analysis.
- Child ordering compares surviving BASE-relative UUID sequences. Ambiguous
  reorder synthesis is a group-metadata conflict even when another branch also
  adds, removes, or moves a child.
- Attachments, history, icons, metadata, and KDBX configuration participate in
  analysis. A state the pinned dependency cannot synthesize safely fails closed
  as a structured conflict. In particular, attachment-bearing historical
  entries are not cloned across database generations without proven rebinding.
- Conflict descriptors carry UUIDs and optional field categories/names, never
  competing password, note, custom-field, attachment, or icon values.
- Inputs are immutable. After tombstones are merged, a merged document is
  returned only after the complete candidate passes the full UUID namespace,
  live/tombstone, reference, root, reachability, parent/child, icon, and cycle
  validator.

The engine has no conflict-resolution UI. It does not partially apply a
conflict, upload, save, choose a side, or mutate an input. Provider/transport
races, multi-writer BASE selection, explicit manual resolution, and safe
installation through `VaultSession` remain outside M3.5.

## M4.2 desktop reveal and clipboard threats and controls

The WebView necessarily originates the password for an explicit unlock, but it
must not become a second unlocked-vault owner. Controls are:

- The password input is `type=password`, uses no browser storage or persistence
  middleware, is never logged, and is cleared immediately after every unlock
  attempt. The Tauri command moves the owned IPC string directly into
  `SecretString`; neither the desktop service nor `VaultSession` retains it.
- The selected absolute path stays in Rust. The WebView receives only a display
  filename, and public desktop errors contain stable codes without paths,
  parser failures, MAC/cipher/KDF details, or dependency debug output.
- Rust owns the only unlocked `VaultSession`. Browse and entry-detail DTOs are
  explicit serde types with exact-key tests. They carry safe summaries,
  password/notes presence, and custom-field name/protection metadata, but no
  password, notes, custom value, TOTP/passkey data, attachment, history, master
  password, `KdbxDocument`, or `VaultSession`.
- `SummaryText::Protected` maps to a marker-only DTO. Missing, visible empty,
  visible text, and protected remain distinct; protected standard-field
  plaintext is never fetched for list rendering.
- Opening an entry never fetches password or notes. Separate fixed commands
  resolve an exact entry UUID and return only one password or notes string after
  the corresponding Reveal action. Runtime validation rejects non-string or
  expanded responses. No generic arbitrary-field reveal exists.
- Reveal plaintext stays in a local detail hook rather than global state or
  browser persistence. Hide and a 15-second timer remove it from state and the
  DOM; entry/group change, Lock start, component unmount, window blur, and hidden
  visibility also clear it. The hidden state renders fixed bullets without
  fetching or retaining the real value.
- Each reveal request has a generation and entry identity. A response for entry
  A is ignored after selecting B, and starting Lock invalidates pending requests
  before the backend result. This controls stale async population of the wrong
  entry or a locking view.
- Copy Username and Copy Password are semantic Rust commands. They resolve the
  UUID through narrow secret-bearing getters and write through `ClipboardPort`;
  password copy returns only a safe receipt, so copy does not introduce password
  plaintext into React. Browser clipboard APIs and the JavaScript clipboard
  plugin are rejected by ESLint and the repository security guard.
- Copy Username, Copy Password, and Lock share one secret-operation lifecycle
  gate. The order is gate, then vault-service mutex; the service mutex is
  released before clipboard I/O, and clipboard state never acquires the gate.
  If copy wins, Lock waits for its write and lease before dropping the session
  and cleaning up. If Lock wins, it drops the session first and the later copy
  returns `Locked` without writing. Thus no already-started gated copy can write
  a vault secret after Lock completes.
- A clipboard lease contains a monotonic generation, secure-random 32-byte salt,
  and SHA-256 digest only. It contains no plaintext string. Expiration reads the
  active clipboard off the main thread and requests clear only if the generation
  is current and the salted fingerprint matches. If content already differs,
  Nian Pass relinquishes ownership and preserves that observed content. Read or
  clear failure also relinquishes the lease: inability to prove ownership or
  complete deletion does not confer indefinite future deletion authority. An
  older timer cannot clear a newer Nian Pass copy.
- Explicit Lock clears frontend secrets immediately, drops the Rust session
  before clipboard I/O, then attempts conditional clipboard cleanup. Clipboard
  read/clear failure is reported as safe `clear_failed` metadata and can never
  prevent session lock. Duplicate unlock remains rejected while a session exists.
- Every Tauri `invoke` is confined to one frontend adapter. Command errors use
  fixed reviewed error codes and never returns parser, filesystem, clipboard
  library, identifier, metadata, or secret details.
- The official clipboard-manager plugin is allowed only in desktop Rust beside
  the dialog plugin. The WebView remains `core:default` only and receives no
  direct clipboard, filesystem, shell, HTTP, process, or updater permission.
  Production CSP is unchanged: bundled local assets and IPC only, with no remote
  content or `unsafe-eval`.
- Rust service tests open the immutable synthetic KDBX fixture without a
  WebView. React tests mock the desktop adapter, so headless CI never needs to
  launch GTK/WebKit or create a display server.

Residual risks remain. Once explicitly revealed, plaintext in JavaScript/WebView
strings cannot be deterministically zeroized; a compromised WebView can observe
it during its bounded lifetime. `keepass-rs` allocations likewise lack a full
zeroization guarantee. The selected cross-platform clipboard API has separate
read and clear calls, not atomic compare-and-clear. An external application can
replace the clipboard in the narrow interval after Nian Pass re-reads and
verifies the salted fingerprint but before the OS processes clear; that content
could then be cleared. Nian Pass cannot eliminate this residual race with its
process-local mutex. Clearing the active clipboard also cannot remove copies held
by OS clipboard history, desktop clipboard managers, cloud clipboard sync, or
third-party utilities. Auto-clear is best-effort at the OS boundary, not secure
erasure. Privacy-sensitive metadata remains visible while unlocked, and native
runtime smoke testing still needs a graphical host. M4.4 has no Save As,
force overwrite, automatic conflict merge, sync transport, autosave, auto-lock,
biometrics, or screenshot protection.

## M3 residual risks

SHA-256 checks provide optimistic conflict detection, not cooperative locking.
An editor can still win the unavoidable interval between the final path check
and atomic replacement. M3 does not add a `.lock` file because KeePassXC and
cloud-folder agents would not honor it. It never auto-reloads or merges on a
conflict.

Directory `sync_all` and atomic rename behavior depend on the operating system
and filesystem. Windows open/read is supported, but write persistence is
explicitly disabled rather than risk losing the destination DACL or using a
delete gap; its fail-closed test is present but has not run on Windows in this
milestone. Network shares, removable media, and cloud-synchronized folders may
reject the Unix primitive; M3 returns an error instead of downgrading safety.

The M3.1 Windows evaluation also treats replacement failure semantics as a
threat. `ReplaceFileW` has the desired documented DACL, EFS, compression, and
named-stream preservation on success, but documented failure states can move
the old file away from its canonical name. Rename-based alternatives preserve
the prepared temp's identity instead of merging the destination security state.
Creating the first backup likewise requires its restrictive security state to
be established before publication. With no primitive satisfying all of those
properties and no native Windows/DACL runtime evidence in current Forgejo
infrastructure, the control remains fail-closed Windows save rather than a
metadata repair after publication or an unsafe fallback.

## Deferred Apple platform design threats (future M9+)

Implemented today are the shared Rust matching/final-read policy, the narrow iOS
FFI generation and ownership controls, read-only semantic command contracts,
and fail-closed source/build ratchets. The native Swift host, App Group,
Keychain integration, signed Credential Provider Extension, and system AutoFill
behavior described below do not exist yet. They are mandatory future controls,
not claims about current production behavior.

The future Credential Provider Extension must be a separate short-lived process
and trust boundary. Host process death must never preserve a decrypted session
for the extension; extension success, cancel, disappearance, timeout, or process
death must close its opaque Rust handle. Each new request must verify the mirror
and ask for the master password again. `provideCredentialWithoutUserInteraction`
must return `userInteractionRequired`; M5.4 stores no unlock material.

An attacker or crash may replace, truncate, or replay the future App Group
mirror. The deferred shared Keychain config must bind the accepted encrypted
generation by complete size and SHA-256; the implemented Rust FFI already checks
those expected values before KDBX parser invocation. Future candidate copy and
atomic swap must preserve the previous verified mirror on pre-commit failure. A
mirror will be only the last successfully refreshed encrypted snapshot, not a
claim that the external source is current. Stale bookmark, revoked access, or
source disappearance must require re-selection and never become silent sync.

The future host security-scoped bookmark grants authority over an external
source and therefore must stay in a host-only Keychain access group. Sharing it
through the App Group or extension Keychain group would let the extension escape
the owned mirror boundary and is forbidden. The future shared Keychain item may
contain only minimal mirror configuration with WhenUnlockedThisDeviceOnly
accessibility and no iCloud synchronization. Neither future Keychain group may
contain a master password, KDBX derived/composite key, or credential password.

Future `ASCredentialIdentityStore` publication will intentionally disclose limited username, domain,
and record-identifier metadata to the operating system when AutoFill is enabled.
These values are privacy-sensitive; Nian Pass does not claim that no metadata
leaves its process. Protected usernames are omitted rather than bulk-revealed,
malformed/no-service entries are omitted, and passwords are never published.
An old identity pointing to a deleted entry or different service cannot release
a stale secret because final fulfillment reopens the verified mirror and
revalidates both stable entry and exact canonical service in Rust.

Future native master-password input must minimize lifetime with a secure field, immediate
field clearing, short-lived mutable UTF-8 bytes, background KDF work, and prompt
buffer cleanup. Swift `String` erasure is not claimed absolute. The password is
never written to React, UserDefaults, Keychain, App Group, clipboard, or logs.
KDF time/memory pressure in the extension fails closed and never lowers vault
parameters.

Raw C pointers introduce lifetime, null, length, allocation, double-free, and
panic-across-ABI risks. The only manually unsafe boundary is the reviewed FFI
module; it validates nulls and bounded lengths, performs no pointer arithmetic,
uses explicit close/free ownership, zeroizes returned credential allocations,
and catches Rust panics as a generic status. Native callers must return exact
allocation triples only once; arbitrary dangling non-null pointers remain
outside what Rust can validate and require Swift ownership discipline plus
Xcode integration tests.

A future Credential Provider target could compile while bypassing the reviewed Rust
FFI and reimplementing credential or KDBX semantics in Swift. The source policy
therefore requires executable-looking calls to every reviewed open, candidate,
identity, final-credential, free, and close ABI symbol, rejects comment-only
markers and conservative duplicate-KDBX patterns, and requires the actual Swift
Credential Provider subclass. The macOS gate must still build and inspect the
embedded extension; neither layer substitutes for system AutoFill smoke.

Future App Group, Keychain access-group, Data Protection, extension capability, or
embedding mistakes can invalidate the intended sandbox. Source ratchets and the
macOS artifact gate inspect both host and extension entitlements, shared group
agreement, password-only capabilities, and the embedded `.appex`. Linux cannot
validate Xcode signing, entitlements, extension memory behavior, or system
Password AutoFill. Claiming otherwise is itself a release-integrity threat.
M5.4 is explicitly DEFERRED because Apple development infrastructure is outside
current product priorities; resumption still requires macOS/Xcode, signed
artifact inspection, and a simulator or device smoke before any support claim.

Locking or dropping the session releases the decrypted database representation,
but ordinary `keepass-rs` strings are not comprehensively zeroized. M3 does not
claim immediate physical erasure from allocator pages, swap, runtime copies, or
dependency internals. A dirty session can still be discarded by an application
that ignores `is_dirty()`; no autosave-on-drop is attempted because `Drop`
cannot report persistence failure.

M2.5 invokes a released KeePassXC CLI only from an explicit test harness. The
harness uses one synthetic public fixture credential, supplies it through
stdin rather than process arguments, disables shell tracing, captures command
output, never emits decrypted XML or protected field values, and performs all
writes in a uniquely created temporary directory removed on drop. A shell
timeout bounds the suite. The immutable source fixture is copied before use and
its bytes are checked again after the external round-trip. Local absence is an
explicit skip; the dedicated CI job uses `--require`, so absence is a failure.
