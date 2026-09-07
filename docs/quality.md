# Quality, Security, and Architecture Policy

M4.Q makes repository policy executable. The canonical pre-merge command is:

```bash
make quality-check
```

The root Makefile is the single source of command semantics. Forgejo installs
runner prerequisites and calls the same targets; it must not reimplement lint,
test, coverage, audit, or architecture commands. `make quick-check` is useful
for feedback but is intentionally not equivalent to the full gate.

## Toolchain and local prerequisites

- Rust 1.98.0 from `.mise.toml`, with rustfmt, Clippy, and `llvm-tools-preview`;
  `rust-toolchain.toml` mirrors the pin for direct Cargo and editor invocations
- Node 26.7.0 from `.node-version`
- Corepack 0.35.0, installed explicitly in Forgejo because Node 26 does not bundle it
- pnpm 11.22.0 from the root `packageManager`
- GNU Make
- Tauri's documented headless GTK/WebKit development packages
- Android NDK 28.2.13676358 and JDK 21 for release APK construction

The dedicated Android gate additionally requires a CLI Android SDK with Android
SDK 36, Build Tools 36.0.0, an installed NDK, Java/JDK, and the
`aarch64-linux-android` plus `x86_64-linux-android` Rust targets. The repository
does not download these large system components, accept licenses, or modify
developer shell profiles. `ANDROID_HOME` or `ANDROID_SDK_ROOT` must identify the
SDK; failures are actionable and non-skipping.

`make tools-install` installs `cargo-deny 0.20.2`, `cargo-machete 0.9.2`, and
`cargo-llvm-cov 0.9.0` into ignored `.bin/`. `make tools-check` rejects missing
or different versions. Frontend tools are exact lockfile-managed dependencies.
Forgejo installs the exact Corepack version before enabling and installing the
pinned pnpm release; it does not assume Corepack is bundled with Node.
The root's exact `smol-toml 1.8.0` dependency parses Cargo policy inputs;
`scripts-check` installs only that locked root tooling before running. No
quality target launches a window, X11, Wayland, or a desktop session.

M8 adds `release-policy-check` to normal deterministic policy, plus
`security-hardening-check`, `release-source-check`, `release-artifact-check`,
and `release-check` as the canonical release interface. `VERSION` is the single
user-facing version authority. Release source requires a clean exact commit and
matching `v<VERSION>` tag. Platform packaging, runtime smoke, and signing remain
separate evidence and never become ordinary Linux quality prerequisites. See
[`release.md`](release.md) and [`reproducible-builds.md`](reproducible-builds.md).
`node-license-check` inventories production packages through the frozen pnpm
graph and permits only the reviewed MIT, Apache-2.0 OR MIT, and MPL-2.0
expressions; an unknown expression fails closed pending review.

## Gate hierarchy

`quality-check` composes fixture integrity, script tests, architecture policy,
the complete Rust gate, the complete desktop frontend gate, security policy,
documentation policy, and the optional local KeePassXC compatibility run.
Forgejo's compatibility job uses `compat-check-required` so a missing external
binary fails. Cargo always uses `--locked`; pnpm install always uses
`--frozen-lockfile`.

M7 adds `sync-source-check`, `sync-core-check`, `sync-provider-check`, and
`sync-integration-check`. Quick feedback runs deterministic source, engine, and
provider tests without containers. The full quality gate runs real KDBX
BASE/LOCAL/REMOTE outcomes, journal recovery/failure injection, WebDAV
loopback protocol tests, and deterministic signed S3 request/result tests; no
AWS account, remote WebDAV account, live credentials, or internet service is
required. Any future DIND object-server image must be immutable-pinned and may
not weaken AWS conditional semantics to satisfy a compatible product.

M7.5 adds `gateway-source-check`, `gateway-server-check`,
`gateway-provider-check`, `gateway-integration-check`, and
`gateway-container-check`. The deterministic gates are part of normal quick and
quality checks. The source gate structurally rejects server
vault/KDBX/session/merge dependencies, provider-core transports, sync-engine
gateway dependencies, blind PUTs, unbounded uploads, TLS bypass, token
persistence, Android INTERNET authority, Apple gateway runtime code, and
background/push sync. It also requires the Linux container and reviewed
self-hosting boundaries.

The server gate exercises missing/wrong/correct authentication, fixed health,
missing reads, byte-exact conditional create, duplicate create, exact and stale
replacement, missing preconditions, simultaneous same-generation replacement,
ciphertext-derived ETags, malformed UUID/traversal, oversized bodies,
permissions, symlink rejection, interrupted uploads, private temporary files,
graceful connection shutdown, and restart persistence. The provider gate uses
loopback servers to verify request headers, strong revisions, 401/404/412
mapping, response bounds, HTTPS-off-loopback policy, redirect rejection,
uncertain PUT classification, mandatory exact read-back, and mismatch failure.

The real integration gate starts the actual Hyper gateway over a local
filesystem and drives `SyncEngine` with the real gateway provider and checked-in
encrypted KDBX 4.1 fixture. It covers first-client create, second-client BASE,
both fast-forward directions, non-overlapping semantic merge, semantic
conflict, Keep Local, Keep Remote, barrier-forced stale CAS, uncertain-result
recovery, restart persistence, and two-client convergence. No JSON fake vault,
internet access, account, Docker daemon, GUI browser, Android SDK, or Apple
toolchain is required for these deterministic tests.

`gateway-container-check` is the runtime authority for the documented Compose
deployment. On a Docker-capable Linux runner it builds the pinned image, starts
the service through the committed Compose file and private environment file,
proves UID/GID 10001, authentication, exact-byte create/read, restart
persistence, stale CAS, process-lock rejection, safe startup categories, and
absence of token values from responses, diagnostics, logs, and image history.
It fails rather than silently skipping when Docker or Compose is unavailable.
The dedicated Forgejo Docker/DIND job owns this gate; environments without a
Docker daemon report it separately as `NOT RUN` rather than treating source
inspection as runtime evidence.

The sync store suite also writes synthetic v1, current v2, future-schema, and
malformed BASE/journal metadata. It requires explicit unsupported-state versus
valid-recovery classification, rejects automatic target attachment, exercises
symlink-safe metadata-only reset, verifies local/remote bytes are untouched, and
checks that the next operation follows normal no-BASE initial-sync behavior. Desktop
contract tests require explicit reset confirmation and cached-engine
invalidation. These are deterministic tests; they do not claim live provider or
Windows runtime validation.

The concrete network dependencies are exactly `reqwest 0.13.4` with
`rustls-no-provider`, `rustls 0.23.43` with Ring,
`aws-sdk-s3 1.144.0`, `aws-smithy-http-client 1.4.0`, and `tokio 1.53.1`. The S3
adapter deliberately does not depend on `aws-config`: it builds the official
SDK service config with explicit credentials, so no default credential
provider or hidden metadata request can start. The SDK HTTPS client is built
explicitly with the Rustls Ring provider; this retains a Rustls-only transport
and keeps Linux-to-Windows checks independent of AWS-LC's external C toolchain.
Cargo-deny review adds only the permissive ISC, MIT-0, and
CDLA-Permissive-2.0 licenses required by the reviewed Rustls/AWS dependency
graph; no M7 advisory ignore or broad package exemption is added.

Architecture checks keep `vault-sync` network-free,
`sync-provider-core` free of concrete transports, `sync-engine` free of Tauri,
desktop providers out of Android production dependencies, the browser native
host independent from sync providers, and Android release INTERNET permission
absent. Source checks reject blind provider methods, production remote HTTP,
redirect following, persisted secret fields, and automatic S3 retry. Unix
tests assert 0700 directories and 0600 BASE/journal/metadata files.

`windows-cross-check` compiles the engine, all three providers, desktop integration,
and the narrow ACL-preserving `ReplaceFileW` adapter for
`x86_64-pc-windows-gnu`. Cross-compilation is not Windows runtime evidence.
Real WebDAV, AWS S3, S3-compatible, Windows desktop-to-gateway, Linux
desktop-to-gateway, HTTPS reverse-proxy, and container runtime smoke remain
manual and must each be reported as RUN or NOT RUN. Ordinary CI stays Forgejo-owned; M7
added no GitHub Actions workflow; M8 adds only the tag/manual existing-tag
multi-platform release workflow and does not duplicate ordinary CI.

M6.5 keeps `browser-source-check` and `browser-extension-check` and adds
`browser-native-protocol-check`, `browser-native-host-check`, and
`browser-integration-check` to normal `quick-check` and `quality-check`. The
focused browser gate runs frozen install,
Prettier, strict typed ESLint, TypeScript, Vitest coverage, 85% changed-line
coverage, Knip, Chromium and Firefox builds, parsed-manifest/artifact validation,
an exact synthetic-secret marker scan, and production dependency audit. Package
coverage ratchets are 85% statements, 80% branches, 85% functions, and 85%
lines. The source ratchet enforces MV3, optional HTTP(S) permissions, dynamic
top-frame registration, synchronous lifecycle listeners, browser-owned sender
identity, exactly one background-owned `connectNative`, no network/storage/
external messages/MAIN-world bridge, detector-local `.value` prohibition, and
no submit path. M6.5 regression
tests additionally prove that the popup invokes optional permission mutation
directly from its click with a preloaded background-derived pattern, background
has no permission-request API, and fill authority requires a validated
content/background Port. Popup, wrong-extension, non-top-frame, unsupported,
and unpermitted Port senders fail closed; document replacement and disconnect
retire ephemeral authority. Candidate-handle and deterministic race tests cover
navigation, origin change, permission removal, document replacement, native
reconnect, duplicate response, and replay.

`browser-native-protocol-check` runs the shared Rust/TypeScript golden contract
and strict framing tests for valid, empty, invalid, oversized, truncated,
multiple, unknown-version, and unknown-message frames.
`browser-native-host-check` spawns the real host with piped stdio and a fake
local IPC server for approval/candidate/credential round trips, and rejects any
KDBX, vault-session, network, or stdout-diagnostic drift. Local IPC tests cover
request-before-approval, Allow, Deny, monotonic timeout, disconnect, and
per-stream approval. A Linux process test exercises install, doctor, and
uninstall under a temporary registration root; tests never modify actual
browser configuration or HKCU. `windows-cross-check` compiles the named-pipe,
HKCU installer, native host, and desktop bridge paths, but is compile evidence
only and does not claim Windows runtime validation.

M6.5 remediation regressions inject bridge startup failure and prove desktop
setup still installs ordinary vault state, unlock/snapshot remains usable, and
resolution against an unavailable bridge fails generically. Unix tests retain
live-endpoint ownership while a second bridge degrades to unavailable; existing
unsafe-runtime, non-socket, and dead-stale-socket checks remain intact. Windows
installer tests use in-memory registry operations and temporary files to inject
candidate write, manifest placement/removal, registry set/delete, and rollback
failures. They cover exact install/uninstall rollback, partial-state
convergence, idempotent absence, bounded prior manifests, and preservation of
unrelated registration data without touching real HKCU.

These deterministic gates build `dist/chromium` and `dist/firefox` but do not
require or launch Chrome, Chromium, Edge, Firefox, X11, Wayland, or any GUI.
Manual unpacked/temporary-extension smoke uses only a synthetic loopback page
bound to `127.0.0.1` and is reported separately. Chromium Native Messaging,
Firefox Native Messaging, Linux host install/IPC, and Windows Native Messaging
smoke must each be reported as RUN or NOT RUN; they are not deterministic gates.
The Forgejo Node frontend job runs the browser source and extension gates with
the same resolved diff base as desktop changed-line coverage. The Rust/Tauri
native job owns `browser-integration-check` because that mixed gate requires
Cargo, native Tauri build prerequisites, Node.js, and the pinned pnpm toolchain.

Routine CI remains in Forgejo Actions on the project's self-hosted Docker/DIND
infrastructure. GitHub Actions owns only the M8 multi-platform production
release workflow on native hosted OS runners. It is tag-only (`v*`) with a safe
manual existing-tag dry-run, never normal branch push, pull request, or schedule
CI. This avoids duplicating ordinary validation cost. Windows, Linux, Android,
browser, gateway, and attestation jobs are release-scoped; native macOS/iOS
release work remains deferred and no Apple runner is present.

`mobile-source-check` is environment-independent and participates in the normal
policy, quick, and quality gates. It verifies the committed Tauri-generated
Android project, API 26 minimum, normal generated ABI set, machine-local ignore
rules, the narrow `TAURI_DEV_HOST` Vite boundary, a network-free main manifest,
and debug-only ownership of the development `INTERNET` permission. For M5.2 it
also ratchets SAF/`ContentResolver`, least-privilege persisted grants, opaque
source and transaction names, exact semantic command whitelist, absence of
URI/path/token frontend DTOs, absence of `VaultSession` from mobile, no force
Save, complete encrypted-generation checks, `AtomicFile` recovery journal,
`WRITE_STARTED` ordering, provider read-back, and absence of Kotlin KDBX logic.
It does not claim an Android binary was built.

For M5.3 the same source ratchet additionally requires both framework services,
their exact binding permissions and metadata, a private credential Activity,
password-only Credential Manager capability, and the exact
`androidx.credentials:credentials:1.6.0` dependency without Play Services auth,
alpha, or floating versions. It rejects direct frontend credential-plugin calls,
password-bearing candidate DTOs, SharedPreferences/plaintext bookmarks, Kotlin
KDBX/credential caches, passkey declarations, broad storage/package permissions,
and Autofill SaveRequest mutation. Rust target matching, narrow password access,
SHA-256 certificate identity, AES-GCM Keystore metadata, AtomicFile/no-backup
storage, and single-use opaque registries are positive source requirements.
The ratchet also requires the official `CallingAppInfo` origin APIs plus a
bundled privileged-browser allowlist, `PendingIntentHandler` begin/final request
reconstruction, native AssistStructure reconstruction, random Intent data
identity without `AtomicInteger`/`FLAG_UPDATE_CURRENT`, correct `onNewIntent`
refresh, READ-only bookmark normalization, verified WRITE release before Lock,
and read-only cold rehydration. Durable metadata is rejected if it references a
Credential Manager request, AssistStructure, AutofillId, Bundle, or Parcel.

For M5.5 the source ratchet additionally requires `FLAG_SECURE`, the guarded
API 33 `setRecentsScreenshotEnabled(false)` call, one native privacy-curtain
controller, weak Activity-scoped resumed/focus authority, `ProcessLifecycleOwner`,
`PowerManager.isInteractive`, `SystemClock.elapsedRealtime`, generation-scoped
acknowledgement, and CredentialActivity authority retirement with exactly-once
completion. It rejects lifecycle `System.currentTimeMillis()`/`Date.now()`,
mobile `localStorage`, `sessionStorage`, IndexedDB, Cache API, or cookies,
BiometricPrompt quick-unlock code, password/password-equivalent persistence,
PiP, accessibility services, and foreground-service declarations. The release
APK verifier also rejects `FOREGROUND_SERVICE`, overlay, network, storage, and
broad package permissions; it does not infer UI behavior by scanning APK strings.

`mobile-tools-check` validates Java, SDK 36, Build Tools 36.0.0, NDK, the two
priority Rust targets, and the repository-pinned Tauri CLI without installing
anything. `mobile-android-check` invokes `tauri android build --apk` for
aarch64 and x86_64, runs the focused Kotlin unit tests, and requires a real APK
artifact containing the native source bridge. It needs neither an
emulator nor a device and remains separate from `quality-check`, so ordinary
Linux/desktop CI never silently skips or unexpectedly requires an Android SDK.
The binary gate also inspects the merged manifest for both credential services,
their binding permissions, password-only provider metadata, and the private
credential Activity, then dumps APK permissions to prove release still has no
`INTERNET`, foreground-service, overlay, or broad storage/package permission.

M5.5 frontend lifecycle tests use Vitest fake timers and synthetic monotonic
timestamps; they cover immediate background shielding, clean authoritative
Lock, dirty/draft non-discard, screen-off attention, resume expiry, failed Lock,
stale unlock/Save/mutation/acknowledgement completion, pending operation
reconciliation, Save-dialog precedence, Continue deadline reset, the five-minute
default, same-process timeout retention across Lock/unlock, new-root reset, and
Never semantics without real sleeps. Strict DTO tests reject extra secret-like
keys. Pure JVM tests cover Activity pause/focus invalidation before delayed
process stop, resume-before-focus, lifecycle generation, duplicate transitions,
stale acknowledgement, cross-Activity identity isolation, all-Activity global
invalidation, detach rejection, interactive-first screen classification,
idempotent curtain policy, API-level
Recents policy, and CredentialActivity exactly-once completion. Android
instrumentation sources assert secure flags and curtain attach/remove behavior,
but the headless gate only compiles them. Compilation is not a claim that those
tests ran on a device or that a real OEM Recents/screenshot path was observed.

Apple validation is explicitly separate and deferred. The dedicated
`mobile-ios-tools-check`, `mobile-ios-source-check`, and `mobile-ios-check`
targets are retained as dormant resumption gates. The full gate remains
macOS/Xcode-only and fails closed until official Tauri iOS initialization has
produced the Apple project and the real host plus embedded Credential Provider
Extension can be built and verified. These Apple-specific gates are excluded
from ordinary Linux development, `quick-check`, `quality-check`, and default CI;
Linux neither fabricates an Xcode project nor reports an iOS pass.

Rust policy keeps `unsafe_code = forbid` unchanged and denies warnings,
unused must-use values, `dbg!`, `todo!`, `unimplemented!`, production unwraps,
and stdout/stderr macros. The CLI has one centralized Clippy allowance because
stdout/stderr is its explicit sanitized user interface, not logging. The KDBX
crate permits stderr only in tests that surface an external KeePassXC child
failure. `expect` remains allowed for documented impossible invariants and
tests. Rustdoc warnings, unused dependencies, advisories, licenses, sources,
tests, coverage, and changed-line coverage all fail their targets.

Frontend policy retains typed ESLint strict/stylistic rules and adds security,
DOM-sanitization, promise safety, exhaustive switches, unused inline-config
reporting, and zero-warning enforcement. `eslint-disable` comments are forbidden
in production source. Browser persistence, console output, dangerous DOM/code
execution, direct Tauri invoke outside the adapter, and remote runtime assets
are independently rejected by ESLint and/or repository guards. Prettier checks
without mutation in quality/CI. Knip checks files, exports, dependencies, and
missing dependencies. The audit wrapper runs `pnpm audit --prod` in JSON mode.
Each attempt is bounded to 90 seconds and it retries once after a recognized
transient registry transport failure. A vulnerability report, unknown failure,
or repeated registry failure remains blocking; registry errors are never
ignored and audit never auto-fixes.

M4.2 additionally forbids `navigator.clipboard`, including window/global aliases,
and every JavaScript clipboard plugin dependency. Username/password copy must use
the semantic desktop IPC adapter rather than a generic browser write API.

## Coverage ratchets

The pre-M4.Q measured Rust line baseline was 87.04% (6118/7029 meaningful
workspace lines), so `RUST_COVERAGE_MIN` is 87%. Tauri build/main composition
files are excluded; handwritten domain, adapter, session, sync, CLI, and desktop
service code remain included.

The pre-hardening desktop baseline was 65.21% statements, 61.90% branches,
63.88% functions, and 64.60% lines. Vitest thresholds are therefore 65%, 60%,
63%, and 64%. Tests, setup, and pure declarations are excluded; business logic
is not. Rust and desktop changed production lines require 85% coverage. CI
provides an explicit base and fails if it cannot resolve it; local runs use
`origin/main`, then `main`, and warn clearly only when neither exists.

Coverage thresholds are ratchets. They may increase without an ADR. Lowering a
threshold requires explicit architecture or security justification and review;
it must never be lowered merely to make CI pass. Coverage is not a substitute
for behavioral assertions or the exact serialized-key whitelist.

## Dependency policy

`cargo-deny` fails known vulnerabilities, yanked releases, unapproved licenses,
unknown registries, and every unapproved git source. Crates.io and workspace
path dependencies are approved. Duplicate versions warn because Tauri and KDBX
currently contain legitimate multi-version graphs; they are still visible for
review. Workspace crates are private and are not assigned an invented project
license by this milestone. Approved dependency licenses are enumerated in
`deny.toml`. M4.2 adds the OSI-approved `BSL-1.0` license used by the official
clipboard plugin's Windows-only transitive crates; this is a license approval,
not an advisory, source, or package exception. M6.5 likewise approves the
OSI-approved `0BSD` license used only by `interprocess` transitive support
crates for the local browser bridge.

M8 updated the runtime transitive `chacha20` lock entry from yanked 0.10.1 to
compatible 0.10.2. Yanked packages are now an explicit deny, even when no
RUSTSEC vulnerability advisory accompanies the yank.

Wildcard registry dependency requirements are denied. A declaration such as
`foo = "*"` is not allowed; dependencies use the repository's existing exact
or deliberately bounded version policy. `allow-wildcard-paths` applies only to
private path dependencies, whose Cargo metadata requirement is `*` when no
publishable version is specified. Workspace/path dependencies therefore remain
valid. Git sources remain denied independently by the source allowlist.

Every advisory exception must name one exact RUSTSEC ID, explain impact and why
no safe upgrade exists, and carry a tracking issue or TODO. Wildcard ignores are
forbidden. Current exceptions are unmaintained-only transitive dependencies:

- `RUSTSEC-2024-0411` through `RUSTSEC-2024-0420`: Tauri's Linux GTK3 stack.
- `RUSTSEC-2024-0370`: `proc-macro-error` through that GTK3 stack.
- `RUSTSEC-2025-0075`, `RUSTSEC-2025-0080`, `RUSTSEC-2025-0081`,
  `RUSTSEC-2025-0098`, and `RUSTSEC-2025-0100`: Tauri `urlpattern`'s `unic`
  dependencies.

TODO(M4.Q-dependency-unmaintained): re-evaluate and remove these exact ignores
when the pinned Tauri Linux stack provides a non-GTK3/non-`unic` upgrade. Any
new vulnerability (as distinct from unmaintained metadata) remains a hard
failure and must not be added to this group automatically.

## Architecture and security exceptions

Architecture exceptions require an exact path, exact maximum, and written
reason in `scripts/architecture-budget.json`. The maximum must exceed the
default, cannot silently increase, and becomes stale once the file fits the
default or disappears. Existing Rust exceptions lock the current production
sizes of `crates/kdbx/src/lib.rs`, `crates/kdbx/src/sync.rs`,
`crates/vault-core/src/lib.rs`, and `crates/vault-session/src/lib.rs`. Tests do
not consume production line budget. TypeScript has no line-budget exceptions.

Cargo dependency boundaries are evaluated with a standards-based TOML parser,
using the actual `package` identity rather than the local import alias. Normal,
dev, build, workspace-inherited, and target-specific dependencies all remain in
the policy model, so renaming `tauri` or `keepass` cannot bypass crate
boundaries. The parser runs in the existing headless Node policy job and never
resolves dependencies over the network or mutates `Cargo.lock`.

Lint exceptions belong in centralized configuration or an exact crate/file
scope with a security reason. Scattered suppressions are not accepted. Coverage
ignores are limited to generated, test-infrastructure, pure-declaration, or
binary-composition files. The CSP keeps `style-src 'unsafe-inline'` only for the
current bundled styling; `unsafe-eval`, wildcard sources, remote connections,
and remote assets remain forbidden.

The production CSP must explicitly contain `default-src`, `connect-src`,
`img-src`, `style-src`, `script-src`, `object-src`, `base-uri`, and `frame-src`.
Their only approved tokens are the current bundled-app values: `default-src`
and `script-src` allow only `'self'`; `connect-src` allows only `ipc:` and
`http://ipc.localhost`; `img-src` allows only `'self'`, `asset:`, and `data:`;
`style-src` allows only `'self'` and `'unsafe-inline'`; and `object-src`,
`base-uri`, and `frame-src` allow only `'none'`. Duplicate or unknown
directives and every unapproved token fail the security gate.

The current plugin/capability allowlist is Tauri core, the Rust dialog plugin,
the official Rust `tauri-plugin-clipboard-manager` dependency only in
`apps/desktop/src-tauri`, and `core:default`. The clipboard dependency remains
forbidden in every core crate and CLI, including renamed Cargo aliases. The
frontend package and direct browser clipboard API remain forbidden, including
npm aliases. No clipboard permission is granted to the WebView; Rust calls the
plugin behind Nian Pass semantic commands. CSP tokens are unchanged. A future
milestone may intentionally update this policy only with threat-model,
capability, CSP, and regression-test review.

M5.2 does not expand the WebView capability or external plugin dependency
allowlist. The first-party Android source plugin is called only from semantic
Rust commands; React never sees its namespace. M5.4 adds a semantic iOS Rust
adapter contract but does not grant its plugin namespace to React.
Production CSP tokens remain unchanged.

## IPC and OpenWiki

`apps/desktop/contracts/desktop-contract.json` is a synthetic, secret-free
cross-language fixture. Rust tests compare it to actual Serde output; frontend
tests feed it through runtime validators. Exact-key validation rejects unknown
fields so future DTO drift cannot silently expose a secret-bearing addition.
Full type generation is deferred until a maintained generator reduces risk
without placing export derives on core secret-bearing types.

`apps/desktop/contracts/mobile-contract.json` covers writable selection, clean
and dirty snapshots, creation receipts, secret-free entry detail, and every
stable M5.2 error. Rust Serde and TypeScript exact-key validators consume it.
Rust tests use only committed synthetic KDBX data and cover unlock/dirty,
wrong Save credential, external generation, verified candidate commit, dirty
Lock, and deterministic operation serialization. A fake `MobileDocumentSource`
runs through the same Rust Save coordinator and injects source preparation,
pre-write, post-write mismatch, semantic verification, cleanup, verified
rollback, and unverified rollback outcomes without sleeps. Kotlin policy tests
cover writable capability, strict transaction identities, exact
crash-generation classification, final mismatch, verified rollback, and
rollback uncertainty.
Vitest uses deferred Promises for pre-await password clearing, Save success,
precommit failure, external conflict, uncertainty, recovery block, read-only
providers, and Save/Discard/Cancel dirty Lock behavior.

M5.3 extends the contract only with exact-key, secret-free status, request, and
candidate DTOs; validators reject extra `password`, `secret`, URI, certificate,
AutofillId, or AssistStructure fields. Rust tests cover exact `AndroidApp` and
canonical-host matching, hostile lookalike domains, current stable-entry
revalidation, deleted candidates, and deterministic Autofill-versus-Lock
serialization. Kotlin/JVM tests cover the metadata codec and AEAD policy,
tampered IV/ciphertext/AAD, corrupt schema, missing key behavior, parser field
classification, package/certificate trust, and single-use tokens without sleeps.
Instrumentation tests exercise the real Android Keystore, no-backup ciphertext,
corruption failure, missing-key failure, and deletion. React tests cover cold
locked authentication, candidate selection, unverified confirmation, cancel,
completion/Lock cleanup, and the absence of password component state.

`mobile-android-check` compiles the real arm64/x86_64 Tauri APK and explicitly
runs `:app:testUniversalDebugUnitTest`, so tests for the first-party source
plugin are not confused with the separate `tauri-android` library tests. These
headless checks do not prove arbitrary third-party DocumentsProvider durability,
cloud behavior, or fsync guarantees. Device/provider smoke remains optional and
must be reported separately.

M5.4 adds `credential-provider-core` and `ios-credential-ffi` to the ordinary
Linux Rust workspace gates. Tests cover exact iOS domain/URL matching,
lookalike rejection, protected identity metadata omission, secret-free
candidate/identity JSON, wrong password, generation tampering before parse,
final stable-entry revalidation, stale-handle replay, explicit close/free, path
confinement, malformed null/length shapes, and panic containment. Android tests
remain the regression authority for exact `AndroidApp`, canonical web matching,
stale entry rejection, and Autofill/Lock serialization after the shared-core
extraction. Frontend tests prove iOS mounts the mobile unlock/browse flow without
Android request probing and renders no Save/CRUD actions.

For future Apple resumption, `mobile-ios-tools-check` is intentionally macOS-only. It requires Xcode,
selected iPhone device/simulator SDKs, pinned Tauri CLI, the iOS device and
Apple-silicon simulator Rust targets, and CocoaPods only when the official
generated graph uses a Podfile. The paired `mobile-ios-check` performs the real
Xcode build and requires one embedded `.appex`. `mobile-ios-source-check` is
structural source/build-graph policy: it resolves the one app-extension
`PBXNativeTarget` through its `PBXSourcesBuildPhase`, `PBXBuildFile`,
`PBXFileReference`, and parent `PBXGroup` paths. That exact production Swift set
must contain the real Credential Provider subclass and the complete reviewed
Rust FFI lifecycle;
host-target or unreferenced Swift calls cannot satisfy the extension requirement.
All production Swift still keeps KDBX semantics out of Swift and uses fail-closed
Keychain policy. Entitlements, the extension plist, and `project.pbxproj` are
validated only for their own responsibilities; PBX comments and marker strings
are not implementation or source-membership evidence.

When Apple work resumes, `mobile-ios-check` composes that source ratchet with the actual pinned-Tauri
Xcode build, requires one embedded `.appex`, and inspects signed host/extension
entitlements for the AutoFill provider capability, the same App Group, shared
Keychain access, and password-only extension capabilities. The artifact verifier
does not treat absence of FFI names from `nm` as failure because release Mach-O
stripping/LTO may remove internal static-link symbol names; the required Swift C
calls plus a successful link are the deterministic build evidence. Neither
source markers nor artifact structure prove runtime Password AutoFill. A real
simulator/device system smoke remains separate. The gate is excluded from Linux
`quick-check`, `quality-check`, and default CI. Its expected macOS prerequisite
failure on Linux is not an ordinary quality failure and never substitutes for
an Apple PASS; M5.4 is DEFERRED by roadmap decision until Apple work resumes.

The workspace keeps `unsafe_code = forbid` globally. Only
`crates/ios-credential-ffi` opts into unsafe code, with
`unsafe_op_in_unsafe_fn = deny`; raw operations are restricted to the exact
`src/ffi.rs` pointer/allocator boundary. Business matching, KDBX parsing,
session registry, generation hashing, and JSON projection remain safe Rust.
Architecture policy must never broaden this exception by wildcard.

M4.3 extends that fixture only with secret-free `dirty`, creation receipts, and
close-policy samples. Password, notes, and custom-field request plaintext is
tested separately with synthetic values and is never committed to the shared
contract fixture. Every mutation response passes the same exact-key snapshot or
creation-receipt validators before replacing React state.
Creation-receipt validation also requires `createdEntryId` or `createdGroupId`
to be a member of the returned snapshot. Frontend regression tests distinguish
failed, empty, and non-empty custom-field loads and prove failed loads cannot
issue a mutation.

M4.4 reuses the exact snapshot fixture for Save and reload responses and adds
only stable error codes. Runtime validation requires an exact-key snapshot with
`dirty=false`; unknown keys, a wrong dirty type, or an added secret field fail
closed. Synthetic Save/reload passwords are tested only as narrow request
arguments and never appear in the committed response fixture.

M4.5 remains headless-testable. Vitest fake timers and a narrow fake window
lifecycle drive activity, blur, focus, absolute elapsed-time reconciliation,
clean and dirty expiry, local drafts, backend `unsaved_changes`, and
manual-Lock/Save races without real sleeps or a GUI runtime. The production
focus API remains confined to `src/lib/window-lifecycle.ts`; no capability or
plugin was added. Browser storage remains forbidden, so the timeout selection
is intentionally memory-only.

Files under `openwiki/` are generated navigation material, not the source of
truth for M4.Q policy. Update source code, README, and `docs/`; let the scheduled
OpenWiki workflow regenerate its pages. Do not hand-edit generated OpenWiki
pages for milestone drift.
