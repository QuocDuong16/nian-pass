import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forbiddenRuntimeDependencies,
  gatewaySecretBuildContextViolations,
  protocolSourceViolations,
} from "../check_gateway.mjs";

test("runtime dependency inspection ignores integration-only dependencies", () => {
  const pkg = {
    dependencies: [
      { kind: "normal", packageName: "sync-provider-core" },
      { kind: "dev", packageName: "kdbx" },
    ],
  };
  assert.deepEqual(
    forbiddenRuntimeDependencies(pkg, new Set(["kdbx", "vault-sync"])),
    [],
  );
  pkg.dependencies[0].packageName = "vault-sync";
  assert.deepEqual(
    forbiddenRuntimeDependencies(pkg, new Set(["kdbx", "vault-sync"])),
    ["vault-sync"],
  );
});

test("protocol policy detects blind writes, weak auth, and missing bounds", () => {
  const violations = protocolSourceViolations({
    server: "fn force_write() { overwrite = true; }",
    storage: "fs::rename();",
    auth: "naive_compare();",
    provider: "danger_accept_invalid_certs();",
  }).join("\n");
  assert.match(violations, /preconditions/);
  assert.match(violations, /blind-overwrite/);
  assert.match(violations, /bounded/);
  assert.match(violations, /locking/);
  assert.match(violations, /constant-time/);
  assert.match(violations, /share/);
  assert.match(violations, /HTTPS/);
  assert.match(violations, /TLS/);
});

test("documented gateway environment file must be excluded from Docker context", () => {
  const selfHosting = "Use deploy/gateway.env with Docker Compose.";
  assert.deepEqual(
    gatewaySecretBuildContextViolations({
      selfHosting,
      dockerignore: "target\nartifacts\ndeploy/gateway.env\n",
    }),
    [],
  );
  assert.match(
    gatewaySecretBuildContextViolations({
      selfHosting,
      dockerignore: "target\ndeploy/gateway-token.txt\n",
    }).join("\n"),
    /deploy\/gateway\.env.*Docker build context/,
  );
  assert.match(
    gatewaySecretBuildContextViolations({
      selfHosting,
      dockerignore: "target\n*.env\n",
    }).join("\n"),
    /deploy\/gateway\.env.*Docker build context/,
  );
  assert.match(
    gatewaySecretBuildContextViolations({
      selfHosting,
      dockerignore: "target\ndeploy/gateway.env\n",
    }).join("\n"),
    /release artifacts must be excluded/,
  );
});
