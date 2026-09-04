import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { isRetryableRegistryFailure, runAudit } from "../run_pnpm_audit.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function sink() {
  let value = "";
  return {
    write(chunk) {
      value += chunk;
    },
    value() {
      return value;
    },
  };
}

test("registry timeout is retryable but a vulnerability report is not", () => {
  assert.equal(
    isRetryableRegistryFailure({
      status: 1,
      stdout: "",
      stderr: "TimeoutError: The operation was aborted due to timeout",
    }),
    true,
  );
  assert.equal(
    isRetryableRegistryFailure({
      status: null,
      stdout: "",
      stderr: "",
      error: Object.assign(new Error("spawnSync pnpm ETIMEDOUT"), {
        code: "ETIMEDOUT",
      }),
    }),
    true,
  );
  assert.equal(
    isRetryableRegistryFailure({
      status: 1,
      stdout: JSON.stringify({ advisories: { "GHSA-test": {} }, metadata: {} }),
      stderr: "",
    }),
    false,
  );
});

test("one transient registry failure is retried and can recover", async () => {
  const results = [
    { status: 1, stdout: "", stderr: "request to advisories/bulk timed out" },
    { status: 0, stdout: '{"advisories":{},"metadata":{}}\n', stderr: "" },
  ];
  const waits = [];
  const output = sink();
  const errorOutput = sink();
  const status = await runAudit({
    audit: () => results.shift(),
    wait: async (milliseconds) => waits.push(milliseconds),
    output,
    errorOutput,
  });

  assert.equal(status, 0);
  assert.deepEqual(waits, [5_000]);
  assert.match(output.value(), /"advisories":\{\}/);
  assert.match(errorOutput.value(), /retrying once/);
});

test("persistent registry failure remains blocking after two attempts", async () => {
  let attempts = 0;
  const errorOutput = sink();
  const status = await runAudit({
    audit: () => {
      attempts += 1;
      return { status: 1, stdout: "", stderr: "ETIMEDOUT contacting registry" };
    },
    wait: async () => {},
    output: sink(),
    errorOutput,
  });

  assert.equal(status, 1);
  assert.equal(attempts, 2);
  assert.match(errorOutput.value(), /ETIMEDOUT contacting registry/);
});

test("advisories and unknown command failures fail immediately", async () => {
  for (const result of [
    {
      status: 1,
      stdout: JSON.stringify({ advisories: { "GHSA-test": {} }, metadata: {} }),
      stderr: "",
    },
    { status: null, stdout: "", stderr: "", error: new Error("spawn failed") },
  ]) {
    let attempts = 0;
    const status = await runAudit({
      audit: () => {
        attempts += 1;
        return result;
      },
      wait: async () => assert.fail("must not retry"),
      output: sink(),
      errorOutput: sink(),
    });
    assert.equal(status, 1);
    assert.equal(attempts, 1);
  }
});

test("repository audit targets retain bounded fail-closed registry policy", () => {
  const makefile = readFileSync(resolve(repositoryRoot, "Makefile"), "utf8");
  const source = readFileSync(
    resolve(repositoryRoot, "scripts/run_pnpm_audit.mjs"),
    "utf8",
  );
  assert.equal(makefile.match(/node scripts\/run_pnpm_audit\.mjs/g)?.length, 2);
  assert.match(source, /spawnSync\("pnpm", \["audit", "--prod", "--json"\]/);
  assert.match(source, /MAX_ATTEMPTS = 2/);
  assert.match(source, /ATTEMPT_TIMEOUT_MS = 90_000/);
  assert.doesNotMatch(`${makefile}\n${source}`, /ignore-registry-errors/);
});
