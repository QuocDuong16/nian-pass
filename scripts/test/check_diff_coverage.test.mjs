import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  changedFiles,
  changedLineNumbers,
  evaluateChangedLines,
  parseArgs,
  parseChangedLines,
  parseLcov,
  resolveBase,
  rustProductionLines,
} from "../check_diff_coverage.mjs";

function temporary(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-diff-coverage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

test("arguments require a bounded threshold and source extensions", () => {
  assert.deepEqual(
    parseArgs([
      "--file", "coverage.lcov",
      "--threshold", "85",
      "--path", "apps",
      "--extension", "rs",
      "--base", "main",
      "--require-base",
    ]),
    {
      file: "coverage.lcov",
      threshold: 85,
      path: "apps",
      extensions: ["rs"],
      base: "main",
      requireBase: true,
    },
  );
  assert.throws(
    () => parseArgs(["--file", "x", "--threshold", "101", "--path", "apps", "--extension", "rs"]),
    /between 0 and 100/,
  );
});

test("LCOV records and changed-line percentages are parsed exactly", (t) => {
  const root = temporary(t, {
    "coverage.lcov":
      "SF:/checkout/apps/desktop/src/a.ts\nDA:2,1\nDA:3,0\nend_of_record\n" +
      "SF:src/b.ts\nDA:1,1\nend_of_record\n",
  });
  const coverage = parseLcov(join(root, "coverage.lcov"), "apps/desktop");
  assert.deepEqual(coverage.get("apps/desktop/src/a.ts"), new Map([[2, 1], [3, 0]]));
  assert.deepEqual(coverage.get("apps/desktop/src/b.ts"), new Map([[1, 1]]));
  assert.deepEqual([...parseChangedLines("@@ -1 +2,2 @@\n+x")], [2, 3]);
  assert.deepEqual(evaluateChangedLines(new Set([2, 3, 4]), coverage.get("apps/desktop/src/a.ts")), {
    covered: 1,
    total: 2,
    uncovered: [3],
    percent: 50,
  });
});

test("git diff includes committed and working-tree changes from the base", (t) => {
  const root = temporary(t);
  const git = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git(["init", "-q"]);
  git(["config", "user.email", "quality@example.test"]);
  git(["config", "user.name", "Quality Test"]);
  mkdirSync(join(root, "apps"), { recursive: true });
  writeFileSync(join(root, "apps/a.rs"), "fn a() {}\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "base"]);
  const base = resolveBase("HEAD", true, root);
  writeFileSync(join(root, "apps/a.rs"), "fn a() {\n  work();\n}\n");
  writeFileSync(join(root, "apps/new.rs"), "fn new_file() {}\n");
  assert.deepEqual(changedFiles(base, "apps", root), ["apps/a.rs", "apps/new.rs"]);
  assert.deepEqual([...changedLineNumbers(base, "apps/a.rs", root)], [1, 2, 3]);
  assert.deepEqual([...changedLineNumbers(base, "apps/new.rs", root)], [1, 2]);
});

test("Rust cfg(test) lines are removed from changed production lines", (t) => {
  const root = temporary(t, {
    "crates/core/src/lib.rs": "pub fn production() {}\n#[cfg(test)]\nmod tests {\n  fn helper() {}\n}\n",
  });
  const filtered = rustProductionLines(
    "crates/core/src/lib.rs",
    new Set([1, 2, 3, 4, 5]),
    root,
  );
  assert.deepEqual([...filtered], [1]);
});
