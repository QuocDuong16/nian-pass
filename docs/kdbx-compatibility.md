# KDBX Compatibility

This document is the source of truth for KDBX read, self-roundtrip, and external
write compatibility verified by Nian Pass. It records evidence from checked-in,
synthetic public fixtures. A format, KDF, or cipher being accepted by the
`keepass-rs` dependency is not enough for a Nian Pass `Verified` claim without
a repository fixture and test.

Read evidence and write evidence are tracked separately. A verified read does
not imply safe writing, and a Nian Pass self-roundtrip does not prove an
external KeePass implementation accepts the output.

## Status meanings

- **Verified** — a trusted checked-in fixture is opened and asserted by the
  Nian Pass compatibility tests.
- **Externally verified** — a released KeePassXC binary independently opens or
  resaves Nian Pass output and Nian Pass verifies the resulting semantics.
- **Partially verified** — only the explicitly described subset is asserted.
- **Unsupported** — the adapter deliberately rejects the format or operation.
- **Not yet tested** — no Nian Pass fixture/test currently proves the claim.

## Database versions

| Feature | Status | Fixture | Source |
|---|---|---|---|
| KDBX 3.1 reading | Verified | `keepass-upstream-kdbx31-aeskdf-aes.kdbx` | `keepass-rs` `test_db_with_password.kdbx` at pinned commit |
| KDBX 4.0 reading | Verified | `keepassxc-upstream-kdbx40-argon2d-aes.kdbx`; `keepassxc-upstream-kdbx40-argon2id-chacha20.kdbx` | `keepass-rs` test resources at pinned commit |
| KDBX 4.1 reading | Verified | `keepassxc-2.7.12-kdbx41.kdbx` | KeePassXC 2.7.12 fixture via `keepass-rs` |
| KeePass 1 KDB | Unsupported | Synthetic header regression test | Adapter accepts only KDBX 3.x/4.x |

`Verified` means that the listed fixture combinations open and their projected
group/entry structure and exact header version match expectations. It does not
mean every feature in that database version is supported or tested.

## KDFs

| Feature | Status | Fixture | Evidence |
|---|---|---|---|
| AES-KDF | Verified | KDBX 3.1 KeePass fixture; KDBX 4.1 KeePassXC fixture | Correct-password and wrong-password tests |
| Argon2d | Verified | KDBX 4.0 Argon2d + AES-256 fixture | Correct-password and wrong-password tests |
| Argon2id | Verified | KDBX 4.0 Argon2id + ChaCha20 fixture | Correct-password and wrong-password tests |

## Outer ciphers

| Feature | Status | Fixture | Evidence |
|---|---|---|---|
| AES-256 | Verified | KDBX 3.1 AES-KDF; KDBX 4.0 Argon2d; KDBX 4.1 AES-KDF fixtures | All open and project expected structure |
| ChaCha20 | Verified | KDBX 4.0 Argon2id + ChaCha20 fixture | Opens and projects expected root entry |
| Twofish | Not yet tested | None | `keepass-rs` has support, but Nian Pass has no checked-in Twofish fixture |

## Database features

| Feature | Status | Fixture/evidence |
|---|---|---|
| Nested groups | Verified | KDBX 3.1 fixture: `General` contains `Subgroup` |
| Empty groups | Verified | KDBX 3.1 fixture: empty `Recycle Bin` group |
| Multiple entries | Verified | KDBX 3.1, KDBX 4.0 Argon2d, and KDBX 4.1 fixture counts |
| Entry summary projection | Verified | Exact visible root titles are asserted across all four fixtures; protected Title/UserName/URL fields project only an opaque protected state, while absent and explicit-empty visible metadata remain distinct |
| Empty fields | Partially verified | Empty entry titles are asserted in KDBX 3.1 and KDBX 4.0; M2 preserves absent versus explicit-empty username/URL and secret reads preserve absent versus explicit-empty password and notes |
| Unicode | Partially externally verified | A title containing Vietnamese, Japanese, emoji, and a combining character is written by Nian Pass, read by KeePassXC, resaved, and reopened unchanged; the source fixture has no externally created Unicode case |
| Custom fields | Not yet tested | Not exposed by the minimal domain projection |
| Entry history | Partially externally verified | Nian Pass and KeePassXC title mutations each append exactly one prior-state history item and preserve it through the external round-trip; the fixture has no pre-existing external history |
| Entry modification timestamp | Partially externally verified | Both tracked title mutations update `LastModificationTime`; KeePassXC `edit` also updates `LastAccessTime`, and other time fields are asserted unchanged |
| Attachments | Not yet tested | Not exposed by the minimal domain projection |
| Tags | Externally verified for fixture | The externally created three-element tag vector, including order, survives Nian Pass save and KeePassXC resave |
| Notes | Partially verified | Exact non-empty and explicit-empty synthetic notes values can be fetched by entry UUID through `SecretString`, distinct from an absent field; notes editing and large-note behavior are not tested |
| Deleted objects | Not yet tested | No Nian Pass assertion |
| Custom icons | Not yet tested | No Nian Pass assertion |
| Protected values | Externally verified for fixture | Both existing password fields remain protected through Nian Pass save and KeePassXC resave; plaintext values are never logged |
| Group metadata | Externally verified for fixture | Complete parsed group equality covers UUIDs, hierarchy/order, notes, tags, times, icons, and custom data represented by `keepass-rs` |

## Malformed input and error behavior

| Case | Verified behavior |
|---|---|
| Correct public fixture password | Opens successfully |
| Wrong password, every checked-in format | `InvalidCredentials` |
| Plain text, TOML, invalid magic, or short bytes | `InvalidKdbx` |
| Truncated copy of every fixture | Returns a typed error without panicking or including the password |
| Corrupted authenticated KDBX 4.x payload | `InvalidKdbx` |
| KeePass 1 KDB header | `UnsupportedFormat` |

The adapter maps `keepass-rs` cryptographic failures on KDBX 3.x to
`InvalidCredentials` because a wrong KDBX 3.1 password is reported upstream as
invalid cipher padding. KDBX 3.x cannot always distinguish a wrong key from
ciphertext corruption at this boundary, so some corrupted KDBX 3.x files may
also be reported as `InvalidCredentials`. For KDBX 4.x, authenticated payload
corruption is regression-tested as `InvalidKdbx`.

An invalid or unknown future major-version header currently maps to
`InvalidKdbx`; future-format detection is not yet precise enough to claim
`UnsupportedFormat` for that case.

## Write compatibility

M1.5 retains the pinned `keepass-rs` `save_kdbx4` boundary. Version `0.13.21`
accepts exact KDBX 4.1 and rejects KDBX 4.0, KDBX 3.x, KDBX 2.x, and KDB. Nian
Pass does not silently upgrade or normalize a database to a different version,
KDF, cipher, or compression mode.

| KDBX 4.1 configuration | Self-roundtrip | KeePassXC open | KeePassXC resave |
|---|---|---|---|
| AES-KDF + AES-256 | Verified | Externally verified | Externally verified |
| Argon2d + AES-256 | Not yet tested | Not yet tested | Not yet tested |
| Argon2id + AES-256 | Not yet tested | Not yet tested | Not yet tested |
| Argon2id + ChaCha20 | Not yet tested | Not yet tested | Not yet tested |

The released KeePassXC 2.7.4 CLI used here does not expose documented
headless options for selecting KDF and outer-cipher combinations during
database creation or editing. Nian Pass does not patch headers or use its own
writer to manufacture external evidence, so the three missing combinations
remain accurately unverified.

| Capability | Status | Evidence |
|---|---|---|
| KDBX 4.1 open → Nian Pass rename → save → Nian Pass reopen | Self-roundtrip verified | Trusted `keepassxc-2.7.12-kdbx41.kdbx`; expected post-mutation database equals reopened database |
| Nian Pass output → KeePassXC open/list | Externally verified | KeePassXC `db-info` reports AES-256, AES-KDF, and two entries; `ls` reads the exact Unicode title |
| KeePassXC title edit/resave → Nian Pass reopen | Externally verified | Nian Pass reopens the separate KeePassXC output and verifies the second title and history delta |
| Exact KDBX 4.1 version and cryptographic configuration | Self and externally verified | Version, KDF parameters, outer cipher, inner cipher, and compression remain equal across A, B, and C |
| Unrelated parsed database semantics | Externally verified for fixture | Metadata, groups, entries, attachments, icons, deleted objects, UUIDs, fields, tags, protected state, history, and timestamps are compared without secret-bearing debug output |
| KeePassXC normalization allowlist | Externally observed | Only internal metadata `_LAST_MODIFIED`, version-dependent `KPXC_RANDOM_SLUG`, and the explicitly edited entry's title, history, `LastModificationTime`, and `LastAccessTime` may change |
| Title mutation protection-mode preservation | Self-roundtrip verified | Protected titles remain protected in memory, history, and after reopen; unprotected titles remain unprotected |
| Same-value title mutation | Verified no-op | Complete parsed database, history, and `LastModificationTime` remain unchanged; a missing title set to empty remains absent |
| Protected Title/UserName/URL projection | Verified secret-free projection | Synthetic protected values project only `SummaryText::Protected`; visible access returns no plaintext |
| Username mutation protection-mode preservation | Self-roundtrip verified | Existing protected/unprotected mode, prior history state, and absent/empty semantics are asserted; a changed unprotected value survives save/reopen |
| URL mutation protection-mode preservation | Self-roundtrip verified | Existing protected/unprotected mode, prior history state, absent/empty semantics, and a Unicode/query-string value are asserted without URL normalization; a changed value survives save/reopen |
| Password mutation protection-mode preservation | Self-roundtrip verified | Existing protected password plus prior protected history survive save/reopen; a synthetic unprotected condition remains unprotected in memory |
| Missing password creation | Verified in memory | Non-empty creates a protected Password field with history/timestamp tracking; missing plus empty remains a complete no-op |
| Missing standard-field memory-protection policy | Self-roundtrip verified | Missing non-empty Title/UserName/URL follow their database protection flags with history/timestamp tracking; false and absent-policy fallbacks remain unprotected, missing plus empty is a no-op, and a protected policy-created UserName survives reopen |
| Same-value username, URL, and password mutations | Verified no-op | Complete parsed database, history, timestamps, protection, and absence remain unchanged |
| KeePassXC-specific nullable group flags and AutoType obfuscation XML encodings | Supporting regression verified | Output XML asserts literal `null` and integer `0`, matching pinned upstream KeePassXC 2.7+ regressions |
| KDBX 4.0 writing | Unsupported | Typed `UnsupportedWriteFormat`; pinned writer only emits exact 4.1 |
| KDBX 3.1 writing | Unsupported | Typed `UnsupportedWriteFormat`; no silent KDBX 4.1 upgrade |
| In-place or atomic filesystem save | Not implemented | The public API remains caller-owned-writer only; see `write-safety.md` |
| Keyfile-based writing | Not implemented | Credential API is password-only |

### External KeePassXC interoperability

The pinned CI external environment is:

- KeePassXC CLI: `2.7.4`
- Package: Debian Bookworm `keepassxc=2.7.4+dfsg.1-2`
- Container: `rust:1.97.1-bookworm`
- Fixture: `keepassxc-2.7.12-kdbx41.kdbx`, created by KeePassXC 2.7.12
- Invocation: `scripts/test-keepassxc-compat.sh --require`

The same suite also passes locally with KeePassXC CLI `2.7.10` from Ubuntu
26.04 package `keepassxc=2.7.10+dfsg1-2ubuntu1`. KeePassXC 2.7.10 additionally
normalizes its internal `KPXC_RANDOM_SLUG`; the comparator allowlists that one
key while still requiring equality for all other metadata.

The harness creates a unique temporary directory, copies the trusted fixture,
performs a Nian Pass Unicode title rename, saves to a new file, asks KeePassXC
to run `db-info` and `ls`, copies that output again, asks KeePassXC `edit` to
rename the second synthetic entry and resave, then reopens the result with Nian
Pass. Password input is supplied through stdin; command arguments and logs do
not contain it. The shell applies a 180-second suite timeout. Local runs skip
with an explicit message when KeePassXC is absent, while the dedicated Forgejo
job requires the binary and pins the package version.

The complete parsed-representation checks cover semantics represented by
`keepass-rs`, including fixture metadata beyond the public `vault-core`
projection. They cannot prove preservation of unknown XML/header fields that
the dependency discards while parsing. No binary equality is asserted because
encryption seeds, IVs, KDF salt, HMACs, and ciphertext legitimately change.

The pinned upstream commit
`2f1dd5e0f1a23dc7420c3fa25f434fe362729b24` includes dedicated writer
regressions derived from this real KeePassXC 2.7.12 fixture. Those upstream
tests remain supporting evidence rather than independent external
compatibility certification.

## Fixture provenance

The authoritative per-file metadata, public test password, source path,
upstream commit, and SHA-256 values are in
[`fixtures/kdbx/README.md`](../fixtures/kdbx/README.md).
