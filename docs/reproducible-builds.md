# Reproducible release inputs

`VERSION` is the authoritative user-facing release version. The release source
gate requires matching desktop Rust/Tauri/npm, CLI, browser host/extension, and
gateway versions. A tag must be exactly `v<VERSION>` and the Git tree must be
clean. Every release records the exact commit and workflow.
Generic semantic prerelease suffixes are accepted. The release workflow
classifies a suffixed version as `prerelease` and an unsuffixed version as
`final` once during preflight; downstream metadata consumes that classification
rather than an operator checkbox.

Pinned inputs are Rust 1.98.0, Node 26.7.0, Corepack 0.35.0 in CI, pnpm 11.22.0,
Tauri CLI 2.11.4, Android SDK/API 36, Build Tools 36.0.0, NDK 28.2.13676358,
Gradle 8.14.3 with its distribution SHA-256, exact Cargo/npm/Gradle dependencies, digest-pinned container
bases, and full-commit-pinned Forgejo and GitHub actions. `Cargo.lock` and `pnpm-lock.yaml` are
required inputs. No production git dependency or floating container/action is
allowed.

Rust release builds use one codegen unit, thin LTO, optimization level 3,
overflow checks, stripped symbols, and no debug info. Panic unwinding is kept:
the retained mobile/FFI containment boundary relies on it, and changing to
abort globally would weaken that boundary. Browser ZIPs use sorted entries,
fixed metadata, stored bytes, and 0644 archive modes. Browser manifests derive
`version_name` directly from the exact package SemVer. Their required numeric
`version` maps alpha, beta, RC, and final into a deterministic fourth component
so `0.1.0-rc.9` remains visibly identifiable and an accepted `0.1.0` final
compares newer. Build outputs can still
differ when platform linker, WebView bootstrapper, Android packaging, or native
installer tooling embeds nondeterministic metadata; checksums identify the
actual released bytes, not a claim of bit-for-bit identity across OS images.
GitHub-hosted `ubuntu-24.04` and `windows-2025` VM images are external release
infrastructure and are not digest-pinned. Their labels and the workflow run are
recorded for traceability, but this is not a claim of bit-for-bit environmental
reproducibility. Everything controlled by the repository remains pinned.
The gateway image records public version, commit, source, and license metadata;
the license label is `NOASSERTION` until the repository adopts an explicit
license, rather than inventing rights in release automation.

Signing credentials are intentionally outside reproducible inputs. Android
reads a complete four-variable signing set from the runner environment and
fails on partial configuration; no keystore path or password is declared in
source. Windows/browser/container/checksum signing follows the same external
secret-store boundary.

The CycloneDX SBOM inventories locked third-party Rust packages reachable by
normal/build edges and production Node components. Dev-only dependency edges
are excluded. It is generated without network access from Cargo metadata and
the installed frozen pnpm graph. It is useful inventory, not a vulnerability
scan or proof that every target-specific component is present in every artifact.

Attestation is ordered to avoid circular hashes. The release manifest records
the source-derived release class, platform payloads, release status, and SBOM
that exist before it, but not
the manifest itself or `SHA256SUMS`. `SHA256SUMS` is generated last over every
final published file except itself, so later modification of the SBOM or
manifest fails checksum verification. Checksums identify one exact build's
bytes; a rebuild of the same source may differ because hosted runners, native
packagers, or timestamped signing are not bit-for-bit reproducible. For that
reason draft assets are replaceable staging material, while published assets
are immutable and corrections require a new version/tag.

Draft staging is the only release mode that builds native artifacts. Manual
publication downloads the reviewed draft for its exact tag, verifies its
manifest and `SHA256SUMS`, and transitions only controlled publication metadata.
It never rebuilds or replaces the platform payload bytes being approved.
