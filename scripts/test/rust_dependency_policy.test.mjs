import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { parse as parseToml } from "smol-toml";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const manifest = parseToml(read("Cargo.toml"));
const lock = parseToml(read("Cargo.lock"));
const deny = parseToml(read("deny.toml"));

function legacyDuplicateViolations(policy = deny, packages = lock.package) {
  const versions = new Map();
  for (const { name, version } of packages) {
    const group = versions.get(name) ?? new Set();
    group.add(version);
    versions.set(name, group);
  }
  const skipped = new Map();
  const violations = [];
  for (const { name, version, reason } of policy.bans.skip) {
    if (!/^=\d+\.\d+\.\d+(?:[+-][\w.\-]+)?$/.test(version)) {
      violations.push(
        `${name}: duplicate exception must pin one exact version`,
      );
    }
    if (!reason?.includes("TODO(M4.Q-dependency-duplicates)")) {
      violations.push(
        `${name}: duplicate exception must document its tracking TODO`,
      );
    }
    if (!versions.get(name)?.has(version.slice(1))) {
      violations.push(`${name}: duplicate exception is not in Cargo.lock`);
    }
    const group = skipped.get(name) ?? new Set();
    if (group.has(version))
      violations.push(`${name}: duplicate exception repeated`);
    group.add(version);
    skipped.set(name, group);
  }
  for (const [name, exceptions] of skipped) {
    const count = versions.get(name)?.size ?? 0;
    if (count < 2 || exceptions.size !== count - 1) {
      violations.push(
        `${name}: exemptions must cover only older duplicates, leaving one enforced version`,
      );
    }
  }
  return violations;
}

test("CI promotes every cargo-deny warning to failure without unlocking dependencies", () => {
  assert.match(
    read("Makefile"),
    /\$\(TOOLS_BIN\)\/cargo-deny --locked check -D warnings --hide-inclusion-graph/,
  );
  assert.equal(deny.bans["multiple-versions"], "deny");
  assert.equal(deny.advisories.yanked, "deny");
});

test("historical transitive duplicates have only exact, tracked, non-stale exemptions", () => {
  assert.deepEqual(legacyDuplicateViolations(), []);
  assert.equal(deny.bans.skip.length, 63);
  const broadened = structuredClone(deny);
  broadened.bans.skip[0].version = ">=0.21";
  assert.match(
    legacyDuplicateViolations(broadened).join("\n"),
    /pin one exact version/,
  );
  const stale = structuredClone(deny);
  stale.bans.skip[0].version = "=99.99.99";
  assert.match(
    legacyDuplicateViolations(stale).join("\n"),
    /not in Cargo.lock/,
  );
  const untracked = structuredClone(deny);
  untracked.bans.skip[0].reason = "temporary";
  assert.match(
    legacyDuplicateViolations(untracked).join("\n"),
    /tracking TODO/,
  );
});

test("vulnerable rustls is upgraded, not exempted from advisory scanning", () => {
  assert.equal(manifest.workspace.dependencies.rustls.version, "=0.23.45");
  assert.deepEqual(
    lock.package
      .filter(({ name }) => name === "rustls")
      .map(({ version }) => version),
    ["0.23.45"],
  );
  assert.deepEqual(deny.advisories.ignore.map(({ id }) => id).sort(), [
    "RUSTSEC-2024-0370",
    "RUSTSEC-2025-0075",
    "RUSTSEC-2025-0080",
    "RUSTSEC-2025-0081",
    "RUSTSEC-2025-0098",
    "RUSTSEC-2025-0100",
  ]);
});
