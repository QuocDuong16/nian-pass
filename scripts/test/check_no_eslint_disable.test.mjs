import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_no_eslint_disable.mjs";

function write(root, name, content) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-eslint-disable-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, "apps/desktop/src/App.tsx", "export const App = () => null;\n");
  return root;
}

test("production frontend source passes without inline lint suppression", (t) => {
  assert.deepEqual(runChecks(fixture(t)), []);
});

test("production eslint-disable is rejected while test files remain out of scope", (t) => {
  const root = fixture(t);
  write(root, "apps/desktop/src/App.tsx", "// eslint-disable-next-line no-alert\nalert('x');\n");
  write(root, "apps/desktop/src/App.test.tsx", "// eslint-disable no-alert\n");

  const violations = runChecks(root);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^apps\/desktop\/src\/App\.tsx:1:/);
});
