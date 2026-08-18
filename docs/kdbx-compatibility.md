# KDBX Compatibility

This document is the source of truth for KDBX read compatibility verified by
Nian Pass. It records evidence from checked-in, synthetic public fixtures. A
format, KDF, or cipher being accepted by the `keepass-rs` dependency is not
enough for a Nian Pass `Verified` claim without a repository fixture and test.

Read evidence and write evidence are tracked separately. A verified read does
not imply safe writing, and a Nian Pass self-roundtrip does not prove an
external KeePass implementation accepts the output.

## Status meanings

- **Verified** — a trusted checked-in fixture is opened and asserted by the
  Nian Pass compatibility tests.
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
| Entry title projection | Verified | Exact root titles asserted across all four fixtures |
| Empty fields | Partially verified | Empty entry titles are asserted in KDBX 3.1 and KDBX 4.0; other empty fields are outside the current projection |
| Unicode | Not yet tested | No checked-in fixture/test asserts Unicode group names or titles |
| Custom fields | Not yet tested | Not exposed by the minimal domain projection |
| Entry history | Partially verified | M1 KDBX 4.1 title mutation appends and reopens one prior-state history item; broader history behavior is untested |
| Entry modification timestamp | Partially verified | M1 KDBX 4.1 tracked title mutation changes and reopens `LastModificationTime`; broader timestamp semantics are untested |
| Attachments | Not yet tested | Not exposed by the minimal domain projection |
| Tags | Not yet tested | Not exposed by the minimal domain projection |
| Large notes | Not yet tested | Notes are not exposed by the minimal domain projection |
| Deleted objects | Not yet tested | No Nian Pass assertion |
| Custom icons | Not yet tested | No Nian Pass assertion |

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

M1 enables only the pinned `keepass-rs` `save_kdbx4` feature. In version
`0.13.21`, the writer accepts exact KDBX 4.1 and rejects KDBX 4.0, KDBX 3.x,
KDBX 2.x, and KDB. Nian Pass keeps that narrow boundary and does not silently
upgrade a database to a different version.

| Capability | Status | Evidence |
|---|---|---|
| KDBX 4.1 open → rename one title → save → Nian Pass reopen | Self-roundtrip verified | Trusted `keepassxc-2.7.12-kdbx41.kdbx` fixture; memory-only output |
| Exact KDBX 4.1 version preservation | Self-roundtrip verified | Header version before and after is `4.1` |
| KDF, outer cipher, inner cipher, and compression preservation | Self-roundtrip verified | Parsed configurations are equal before save and after reopen |
| Group/entry counts, hierarchy order, names, UUIDs, and untouched titles | Self-roundtrip verified | Private semantic snapshot assertions |
| Complete `keepass::Database` parsed representation | Self-roundtrip verified | Expected post-mutation database equals reopened database without debug-dumping contents |
| Entry history and `LastModificationTime` for title rename | Self-roundtrip verified | Upstream tracked mutation appends one prior-state history item, updates the timestamp, and both survive reopen |
| KeePassXC-specific nullable group flags and AutoType obfuscation XML encodings | Supporting regression verified | Output XML asserts literal `null` and integer `0`, matching pinned upstream KeePassXC 2.7+ regressions |
| KeePassXC opens Nian Pass output | Not yet externally verified | No released KeePassXC process has opened and resaved Nian Pass output in this repository suite |
| KDBX 4.0 writing | Unsupported | Typed `UnsupportedWriteFormat`; pinned writer only emits exact 4.1 |
| KDBX 3.1 writing | Unsupported | Typed `UnsupportedWriteFormat`; no silent KDBX 4.1 upgrade |
| In-place or atomic filesystem save | Not implemented | M1 exposes only a caller-owned writer; see `write-safety.md` |
| Keyfile-based writing | Not implemented | M1 credential API is password-only |

The complete parsed-representation equality check covers semantics represented
by `keepass-rs`, including the fixture's metadata beyond the public
`vault-core` projection. It cannot prove preservation of unknown XML/header
fields that the dependency discards while parsing, and it is not a
byte-for-byte ciphertext comparison because encryption seeds and IVs are
regenerated on save.

The pinned upstream commit
`2f1dd5e0f1a23dc7420c3fa25f434fe362729b24` includes dedicated writer
regressions derived from a real KeePassXC 2.7.12 KDBX 4.1 fixture. Those tests
cover `EnableSearching`, `EnableAutoType`, and
`DataTransferObfuscation`, plus broader generated KDBX 4.1 roundtrips. Nian Pass
asserts the three KeePassXC-sensitive encodings on its own saved output, but
upstream regression evidence remains supporting evidence rather than external
compatibility certification.

## Fixture provenance

The authoritative per-file metadata, public test password, source path,
upstream commit, and SHA-256 values are in
[`fixtures/kdbx/README.md`](../fixtures/kdbx/README.md).
