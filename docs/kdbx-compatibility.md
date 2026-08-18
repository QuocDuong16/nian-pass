# KDBX Compatibility

This document is the source of truth for KDBX read compatibility verified by
Nian Pass. It records evidence from checked-in, synthetic public fixtures. A
format, KDF, or cipher being accepted by the `keepass-rs` dependency is not
enough for a Nian Pass `Verified` claim without a repository fixture and test.

Nian Pass is read-only. This matrix does not cover writing, saving, modifying,
merging, or round-trip preservation.

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
| Entry history | Not yet tested | Not exposed by the minimal domain projection |
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

## Fixture provenance

The authoritative per-file metadata, public test password, source path,
upstream commit, and SHA-256 values are in
[`fixtures/kdbx/README.md`](../fixtures/kdbx/README.md).
