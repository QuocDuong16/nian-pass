# Canonical release procedure

Forgejo is the source-development and canonical routine CI authority. GitHub is
a mirror used as the production multi-platform release execution and
distribution surface. Routine branch, pull-request, scheduled, quality,
security-policy, gateway, and Windows cross-check work remains in
`.forgejo/workflows/quality.yml`. `.github/workflows/release.yml` runs only for
an explicit `v*` tag or a manual dispatch naming an existing `v*` tag; it never
builds a branch or mutates source. Apple projects, builds, signing, and runners
are not part of this procedure.

## Source and version

`VERSION` also determines the GitHub release class. A suffix such as `-rc.1`
or `-beta.2` means prerelease; an unsuffixed version is final. Draft is an
independent staging state, so an RC can be a draft prerelease before review and
a published prerelease afterward. A final version is never marked prerelease.

1. Approve one exact clean commit after canonical Forgejo CI is green. Do not
   create a release tag before that review.
2. Create one `v<VERSION>` tag at that commit and propagate that exact tag to
   the GitHub mirror. If mirroring does not propagate tags, push the existing
   tag explicitly; never recreate the same tag at another commit.
3. GitHub starts from a clean checkout of `refs/tags/<tag>` with full history. Every build compares
   its HEAD to the preflight commit and runs the repository source gate.
4. `make release-source-check` fails on a dirty tree, a missing/mismatched
   tag, `refs/tags/<tag>^{commit} != HEAD`, drift from `VERSION`, unpinned
   dependencies/actions/images, or toolchain disagreement.

Release preflight runs `release-source-check`, `release-policy-check`, and
`security-hardening-check`. It relies on the observed Forgejo result for the
full routine `quality-check`; it does not duplicate that expensive development
pipeline merely to obtain another badge.

From the clean checkout, `release-source-check` precedes artifact assembly;
record SHA-256 checksums for the canonical release directory and record every
unavailable runtime validation honestly as `NOT RUN`.

A tag push builds and stages a draft only; it never publishes. GitHub marks the
draft prerelease or final solely from `VERSION`, and an existing draft whose
classification differs from source fails closed. An
actual publication is permitted only through `workflow_dispatch` with the same
existing release tag, `publish=true`, and an operator-observed
`forgejo_ci_status=PASS`. Publication additionally requires an existing
validated draft; it never creates and publishes a release in one operation.
`NOT RUN` is sufficient only for a draft dry-run.

`publish=false` (including a tag push) runs the full native build and
attestation path, then creates or updates a draft. In contrast,
`workflow_dispatch` with `publish=true` performs only preflight and
publication validation: it downloads the assets attached to the existing draft
for the exact tag and never rebuilds platform payloads. This preserves the
reviewed bytes; lower Actions usage is a consequence, not the reason for the
split.

## Platform builds

- Linux: on pinned Linux tooling, `make release-linux-build`. It creates the
  Tauri AppImage and deb plus a deterministic Native Messaging host ZIP.
- Windows x86_64: on a native Windows runner with Rust MSVC and WebView/Tauri
  prerequisites, `make release-windows-build`. It creates NSIS output and the
  Windows Native Messaging host ZIP. Cross-compilation is not runtime proof.
- Browser: `make release-browser-package` creates deterministic Chromium and
  Firefox ZIPs. They retain the documented development identities and are not
  Chrome Web Store or AMO signed identities. Store publication must supply the
  final public IDs to a matching native-host build and record store signing;
  no private store key belongs in source or artifacts. The manifest uses a
  four-integer store version for browser compatibility and records the exact
  source SemVer in `version_name`; RC, beta, and final ordering is deterministic.
- Android: with the pinned SDK/NDK/JDK, `make release-android-build`. The release
  verifier rejects INTERNET, unexpected permissions/services, missing
  `FLAG_SECURE`, or missing native libraries. Optional signing consumes
  `NIAN_PASS_ANDROID_KEYSTORE`, `NIAN_PASS_ANDROID_KEYSTORE_PASSWORD`,
  `NIAN_PASS_ANDROID_KEY_ALIAS`, and `NIAN_PASS_ANDROID_KEY_PASSWORD` only from
  the runner environment; a partial set fails closed. With no set configured,
  the unsigned build is reported NOT CONFIGURED.
- Gateway: `make release-gateway-image` builds the digest-pinned non-root image
  with public version/commit labels and stages a deterministic-gzip Docker image
  archive plus image reference metadata. Push/tag/sign it only through an
  authorized registry step.

GitHub release jobs build independently on native `windows-2025` and Linux
`ubuntu-24.04` hosted runners. Windows produces MSVC/NSIS and its native host;
Linux produces AppImage/deb and the executable-mode-preserving native-host ZIP;
separate jobs produce browser, Android, and gateway payloads. Each job uploads
only its payload. The attest job rejects unexpected files while assembling one
canonical set, then scans and hashes the exact bytes later passed to GitHub
Release. Hosted runner VM labels are external infrastructure, not immutable
digest-pinned build environments; provenance records that limitation.

## Artifact integrity and signing

Downloaded platform payloads are separated under ignored
`artifacts/platforms/<platform>/`. `make release-assemble` accepts only the
documented Windows, Linux, browser, Android, and gateway payload patterns and
copies them into a clean `artifacts/release/`. Then `make
release-artifact-check` scans names, inspectable browser archives and
bytes for forbidden files, known secret sentinels, and secret-like text
assignments. It recursively inspects bounded gzip TAR archives, Docker saved
image plain nested `layer.tar` files, and Debian package payload TARs without
executing them. Generation order is scan, `release-status.md`,
`sbom.cdx.json`, commit/tag/toolchain/artifact `release-manifest.json`, then
`SHA256SUMS` last. The manifest inventory binds platform payloads,
`release-status.md`, and `sbom.cdx.json`; it intentionally excludes itself and
`SHA256SUMS` to avoid circular metadata. `SHA256SUMS` covers every final
published file, including the status report, SBOM, and manifest, and excludes
only itself. This scan is a regression defense, not proof of total secret
absence, and it does not claim coverage of opaque proprietary installer
formats.

For publication, the downloaded `release/` directory remains the exact
validated DRAFT snapshot. The workflow copies it into a separate PASS candidate,
regenerates and verifies the candidate metadata/checksums, then rechecks the
remote GitHub Release before upload. After the draft-to-published attempt it
uses the observed remote release state—not the client exit code alone—to decide
whether publication succeeded. A still-draft release is restored from the
verified DRAFT snapshot only after a second matching-draft observation. Unknown,
mismatched, or already-published state is ambiguous and fails without rollback.
The manifest and checksums must bind the downloaded draft to the exact version,
tag, commit, release class, and canonical inventory before any mutation. Only
`release-status.md`, `release-manifest.json`, and `SHA256SUMS` may transition
from DRAFT to PASS; platform payloads and the SBOM are byte-preserved and are
never uploaded or clobbered during publication.

Signing is optional only when credentials are unavailable, not implicit. The
Windows job can import a PFX from its two job-scoped GitHub secrets, sign and
verify the native host/NSIS output with SHA-256 Authenticode, then remove the
temporary certificate. Android uses its four job-scoped signing values and a
temporary decoded keystore; partial signing configuration fails closed.
Browser stores, container provenance, and checksum signatures are external
release-authority steps. Never place keys, certificates, passwords, tokens, or
base64 key material in Git, command arguments, logs, or artifacts. Record
`PASS`, `NOT CONFIGURED`, or `NOT RUN` for each signing target.

## Runtime smoke and report

Use only copied synthetic fixtures. Linux and Windows desktop smoke is: launch,
select, unlock, browse, mutate, Save, Lock, reopen, explicit test-gateway sync,
and browser-host handshake. Android verifies APK permissions/declarations and,
when a device exists, unlock/browse/Save/Lock, Credential Provider, Autofill,
and Activity privacy lifecycle. Browser smoke loads each package, grants one
test origin, approves one connection, fills without submit, reconnects, and
proves old approval/candidates are invalid. Gateway smoke includes non-root
startup, auth, CAS, restart persistence, locking, limits, permissions, and no
token in logs/image.

Every release report uses the status matrix requested by M8. Process-level
diagnostics and package checks are not full GUI/device runtime validation.
`NOT RUN` never becomes `PASS`; unsigned never becomes signed. Tag runs and
manual dry-runs stage a draft with its source-derived release class. Missing releases are
created as drafts, and existing draft assets and notes may be replaced while
staging. Once a release is published, this workflow treats its artifacts,
checksums, notes, and title as completely immutable; any correction requires a
new `VERSION`, tag, and release. A manual operator may explicitly publish a
release only after reviewing the canonical artifact set and recording
Forgejo PASS; this workflow never calls an experimental release stable. Publish
checksums, SBOM status, release notes, known accepted risks, and the exact
commit. A gateway volume is
not trusted history. Back up stopped volumes independently. Nian Pass cannot
recover a forgotten KDBX master password; lost provider credentials or gateway
tokens must be rotated/replaced at the provider or gateway. Start from
[`release-status-template.md`](release-status-template.md) so no platform or
signing status silently disappears.

## RC progression

Release candidates are immutable generations, not mutable labels:

```text
0.1.0-rc.1 -> Windows dry-run stopped before native validation because the Rust pin parser was CRLF-sensitive
0.1.0-rc.2 -> native platform payloads assembled, but attestation checksum verification used the repository cwd
0.1.0-rc.3 -> full multi-platform build, attestation, and draft prerelease passed
0.1.0-rc.4 -> publication transaction hardening before real publish validation
0.1.0      -> final only after the accepted RC
```

Every step requires a new source commit, matching `VERSION`, matching tag, and
new release. Never move an existing RC tag, replace published RC assets, or
reuse an existing RC tag for corrected source. Version progression remains an
explicit reviewed source edit; release automation does not increment or promote
versions.
