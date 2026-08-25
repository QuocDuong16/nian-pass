import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { runChecks } from "../check_docs.mjs";

function write(root, name, content) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nian-pass-docs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(
    root,
    "README.md",
    "M4.4 — Desktop Save / External Modification / Conflict UX\nExplicit Save. " +
      "External divergence is not automatically merged. No Save As, force overwrite, or autosave.\n" +
      "make quality-check\nHeadless Linux\nWindows persistence remains deferred. " +
      "The active clipboard clears only if it still contains the value written by Nian Pass.\n",
  );
  write(
    root,
    "docs/architecture.md",
    "M4.Q quality architecture. Clipboard salt then SHA-256 fingerprint then generation.\n",
  );
  write(
    root,
    "docs/threat-model.md",
    "Compromised supply-chain dependencies. OS clipboard history may retain data.\n",
  );
  write(root, "docs/write-safety.md", "Windows persistence is unsupported and fails closed.\n");
  write(
    root,
    "docs/quality.md",
    "Coverage ratchet. Lowering requires architecture or security review. eslint-disable is forbidden. " +
      "unsafe_code = forbid. Exceptions require an exact path. cargo-deny. pnpm audit --prod. " +
      "navigator.clipboard is forbidden. clipboard-manager only in apps/desktop/src-tauri. " +
      "Corepack 0.35.0. OpenWiki is not the source of truth.\n",
  );
  write(root, "AGENTS.md", "Do not hand-edit generated OpenWiki pages.\n");
  write(root, ".node-version", "26.7.0\n");
  write(
    root,
    "package.json",
    '{"engines":{"node":"26.7.0"},"packageManager":"pnpm@11.22.0"}\n',
  );
  write(
    root,
    ".forgejo/workflows/quality.yml",
    "node:26.7.0\nnpm install --global corepack@0.35.0\npnpm@11.22.0\n",
  );
  return root;
}

test("complete policy documentation passes", (t) => {
  assert.deepEqual(runChecks(fixture(t)), []);
});

test("runtime version drift is rejected", (t) => {
  const root = fixture(t);
  write(root, ".node-version", "26.7.1\n");
  assert.match(runChecks(root).join("\n"), /same exact version/);
});

test("missing explicit Corepack bootstrap is rejected", (t) => {
  const root = fixture(t);
  write(root, ".forgejo/workflows/quality.yml", "node:26.7.0\npnpm@11.22.0\n");
  assert.match(runChecks(root).join("\n"), /Corepack 0\.35\.0 must be installed explicitly/);
});

test("missing quality policy is reported", (t) => {
  const root = fixture(t);
  write(root, "docs/quality.md", "OpenWiki\n");
  const violations = runChecks(root).join("\n");
  assert.match(violations, /coverage ratchet/);
  assert.match(violations, /unsafe Rust/);
});
