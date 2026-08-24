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

- Rust 1.97.1 with rustfmt, Clippy, and `llvm-tools-preview`
- Node 26.7.0 from `.node-version`
- Corepack 0.35.0, installed explicitly in Forgejo because Node 26 does not bundle it
- pnpm 11.22.0 from the root `packageManager`
- GNU Make
- Tauri's documented headless GTK/WebKit development packages

`make tools-install` installs `cargo-deny 0.20.2`, `cargo-machete 0.9.2`, and
`cargo-llvm-cov 0.9.0` into ignored `.bin/`. `make tools-check` rejects missing
or different versions. Frontend tools are exact lockfile-managed dependencies.
Forgejo installs the exact Corepack version before enabling and installing the
pinned pnpm release; it does not assume Corepack is bundled with Node.
The root's exact `smol-toml 1.8.0` dependency parses Cargo policy inputs;
`scripts-check` installs only that locked root tooling before running. No
quality target launches a window, X11, Wayland, or a desktop session.

## Gate hierarchy

`quality-check` composes fixture integrity, script tests, architecture policy,
the complete Rust gate, the complete desktop frontend gate, security policy,
documentation policy, and the optional local KeePassXC compatibility run.
Forgejo's compatibility job uses `compat-check-required` so a missing external
binary fails. Cargo always uses `--locked`; pnpm install always uses
`--frozen-lockfile`.

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
missing dependencies. `pnpm audit --prod` is blocking and never auto-fixes.

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
not an advisory, source, or package exception.

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

## IPC and OpenWiki

`apps/desktop/contracts/desktop-contract.json` is a synthetic, secret-free
cross-language fixture. Rust tests compare it to actual Serde output; frontend
tests feed it through runtime validators. Exact-key validation rejects unknown
fields so future DTO drift cannot silently expose a secret-bearing addition.
Full type generation is deferred until a maintained generator reduces risk
without placing export derives on core secret-bearing types.

Files under `openwiki/` are generated navigation material, not the source of
truth for M4.Q policy. Update source code, README, and `docs/`; let the scheduled
OpenWiki workflow regenerate its pages. Do not hand-edit generated OpenWiki
pages for milestone drift.
