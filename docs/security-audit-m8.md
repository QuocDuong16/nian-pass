# M8 security review

This review covers commit-derived M8 source for Windows/Linux desktop, Android,
the browser extension and Native Messaging host, and the Linux Sync Gateway.
Apple runtime work is excluded. Ratings describe realistic impact within the
documented threat model: **BLOCKER**, **HIGH**, **MEDIUM**, **LOW**, or
**ACCEPTED RISK**.

## Findings and disposition

| Rating | Boundary | Finding | Disposition |
|---|---|---|---|
| BLOCKER | Release | No authoritative version/tag/clean-tree gate, artifact set manifest, checksums, or tag-only release workflow existed. | Fixed by `VERSION`, `release-source-check`, deterministic staging, SHA-256 manifesting, and the Forgejo release workflow. |
| HIGH | Unix filesystem | Sensitive leaf files were checked with `symlink_metadata` and then reopened by path, leaving avoidable leaf-symlink races. | Fixed for vault reads, sync state reads/directory sync, and gateway object, temp, lock, and token opens with descriptor-verified `O_NOFOLLOW` access. Existing atomic replace/CAS protocols remain unchanged. |
| HIGH | Gateway token file | A token file could be group/world readable after it was opened. | Fixed: Unix token files must have no group/other permission bits and are opened without following the leaf symlink. |
| MEDIUM | Release artifacts | Browser ZIP bytes inherited filesystem timestamps and artifact contents were not inspected as one release set. | Fixed with deterministic stored ZIP output and behavioral checksum/forbidden-content checks. The scan is a regression defense, not proof that no secret exists. |
| MEDIUM | Desktop webview | CSP lacked an explicit form submission boundary. | Fixed with `form-action 'none'`; remote runtime URLs, frames, objects, eval, arbitrary network access, and unreviewed capabilities remain rejected by policy. |
| MEDIUM | Build inputs | The Cargo MSRV declared 1.97.1 while the actual repository toolchain was 1.98.0; Android NDK selection accepted whichever installation sorted latest. | Fixed by aligning Cargo to Rust 1.98.0 and pinning NDK 28.2.13676358. |
| LOW | Diagnostics | Rust policy omitted several newer workspace runtime roots and Android only rejected verbose/debug logging calls. | Fixed by scanning all sensitive Rust roots, all Android `Log`/stdout/stderr calls, and browser console calls. CLI and bounded process-boundary diagnostics remain explicit exceptions. |
| LOW | Rust supply chain | A newly yanked `chacha20 0.10.1` remained in the runtime graph and `cargo-deny` only warned. No vulnerability advisory was attached, but retaining a yanked cryptographic package conflicts with release policy. | Fixed by the narrow lockfile update to compatible `chacha20 0.10.2`; `cargo-deny` now rejects future yanked packages. |
| ACCEPTED RISK | Local filesystem | An attacker controlling a sensitive file's parent directory can rename entries between operations; Unix leaf no-follow does not provide a fully anchored `openat2` directory tree. | Same-user directory compromise is outside the confidentiality boundary. Fingerprints, exact source identity, safe replace, CAS, private directories, and fail-closed errors limit corruption. A storage rewrite is not justified without a concrete exploit. |
| ACCEPTED RISK | Windows filesystem | Safe replace preserves Windows semantics, but this Linux review did not prove every ACL or reparse-point behavior at runtime. | Release requires real Windows smoke and records `WINDOWS RUNTIME NOT RUN` when unavailable. The application assumes the user profile and selected vault directory ACLs are trustworthy. |
| ACCEPTED RISK | Gateway capacity | The gateway has a 64 MiB per-request bound but no tenant quota or historical version store. An authenticated client can consume the mounted filesystem. | Operators must isolate `/data`, monitor capacity, rate-limit at the proxy, and retain independent stopped-volume backups. |
| ACCEPTED RISK | Memory/clipboard | JavaScript strings, SDK internal credential copies, OS clipboard/history, kernel memory, swap, crash dumps, and privileged process inspection cannot be reliably zeroized by the application. | Lifetimes and copies are minimized; no false zeroization guarantee is made. |

No unresolved BLOCKER or HIGH finding is accepted by this review. Real platform
runtime validation can still reveal a new finding and must not be inferred from
source or cross-compilation evidence.

## Boundary review

- Vault/session: `SecretString` owns Rust secret inputs, the session remains the
  sole decrypted authority, dirty state gates Save/Lock, source identity is
  fingerprinted, and recovery never silently blesses an uncertain generation.
- Filesystem: same-directory private temps, verified safe replace, 0600 files,
  0700 state directories, leaf no-follow reads, sync journal ordering, and
  parent sync preserve crash consistency. Windows ACLs are not replaced with
  Unix mode assumptions.
- Network: non-loopback HTTPS, disabled redirects, bounded headers/bodies,
  explicit timeouts, no automatic S3 PUT retry, strong revisions, read-back
  confirmation, CAS-only mutation, and ambiguous-write errors remain intact.
- Browser: approval is connection-scoped; origin, top frame, nonce, document,
  candidate, Native Messaging generation and vault session are rebound before
  final retrieval. Reconnect loses authority. Candidate DTOs are secret-free.
- Android: Keystore-encrypted private metadata, read-only remembered grants,
  credential/autofill request reconstruction, exact Activity curtain authority,
  `FLAG_SECURE`, and release no-INTERNET checks remain intact.
- Gateway: opaque UUID-addressed ciphertext, token digest comparison, bounded
  HTTP parsing, non-root container, one-process locking, private storage,
  atomic CAS replacement, fixed diagnostics, and loopback-first deployment
  remain intact.

## Secret inventory

| Value | Entry and copies | Persistence and lifetime | Logging/frontend boundary |
|---|---|---|---|
| Master password | Tauri/Android input string becomes Rust `SecretString`; KDBX dependencies receive a borrowed plaintext view. Sync takes a separate short-lived input. | Request/session operation memory only; never profiles, BASE, journal, gateway, or browser. JS input strings cannot be zeroized reliably. | Never logged. Desktop/Android WebView necessarily originates the input but does not receive it back. |
| Entry passwords and notes | Decrypted KDBX document owns values; explicit reveal creates a bounded IPC string; copy uses `SecretString` and the clipboard; browser response uses zeroizing Rust transport buffers then JS strings. | In-memory until Lock; reveal/browser copies live until references are dropped; clipboard lifetime/history is OS-controlled. | Never diagnostic output. Only the explicit reveal/copy/fill consumer receives plaintext. |
| WebDAV password | Sync form input to `SecretString`, then borrowed by reqwest Basic Auth. | One explicit provider operation; not persisted. HTTP permitted only on loopback. | Authorization is never logged or returned. |
| S3 keys/session token | Form inputs become `SecretString`; the AWS SDK necessarily owns credential copies for the request client. Access-key ID is treated as sensitive metadata. | One explicit provider operation; ambient credential chains are disabled; not persisted. | Never logged or returned. SDK/compiler/allocator zeroization is not guaranteed. |
| Gateway bearer token | Form input or gateway environment/private token file; server immediately derives a verifier and zeroizes the source string. | Client request lifetime; server verifier lifetime. Environment visibility to host/container administrators is accepted. | Authorization and token text are never logged or returned. |
| Android metadata key | Non-exportable AES-256-GCM key generated in Android Keystore. | Keystore lifetime until metadata disable/reset; plaintext key bytes are not exported. | Never crosses the native bridge or logs. |
| Browser credential response | Desktop validates exact session/origin/entry, host transports one bounded response, background validates again, content fills exact handles. | No extension storage/cache; JS strings live until GC. | Popup and extension logs never receive it; no auto-submit. |

## Panic and error review

Workspace Clippy denies `unwrap_used`, unsafe Rust, debug macros, stdout/stderr
outside explicit binaries, and warnings. User-controlled KDBX, sync metadata,
provider, gateway, Tauri, Native Messaging, and Android bridge paths use typed,
payload-free errors. Remaining `expect` calls in production are process startup
termination or infallible formatting into `String`; tests contain the other
panic assertions. Panics are not used to reject external data.
