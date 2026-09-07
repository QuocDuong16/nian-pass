import assert from "node:assert/strict";
import { test } from "node:test";

import {
  forbiddenRuntimeDependencies,
  gatewayContainerNetworkProbeViolations,
  gatewaySecretBuildContextViolations,
  gatewayWorkflowDependencyViolations,
  protocolSourceViolations,
} from "../check_gateway.mjs";

test("gateway container probes use a pinned client inside the Compose network", () => {
  const networkProbe = `
curl_image="curlimages/curl:8.14.1@sha256:${"a".repeat(64)}"
docker run --detach --network "\${network}" "\${curl_image}"
docker exec "\${curl_container}" curl --silent
base_url="http://sync-gateway:8080"
`;
  assert.deepEqual(gatewayContainerNetworkProbeViolations(networkProbe), []);

  const hostLoopbackProbe = networkProbe.replace(
    'base_url="http://sync-gateway:8080"',
    'base_url="http://127.0.0.1:${port}"',
  );
  assert.match(
    gatewayContainerNetworkProbeViolations(hostLoopbackProbe).join("\n"),
    /Docker host shares the job loopback/,
  );
});

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

test("Forgejo gateway smoke installs pinned source-policy dependencies", () => {
  const workflow = `jobs:
  gateway-container:
    runs-on: docker
    steps:
      - run: |
          node_version="26.7.0"
          npm install --global corepack@0.35.0
          corepack install --global pnpm@11.22.0
      - run: make scripts-install
      - run: make gateway-container-check
  another-job:
    runs-on: docker
`;
  assert.deepEqual(gatewayWorkflowDependencyViolations(workflow), []);

  const withoutInstall = workflow.replace(
    "      - run: make scripts-install\n",
    "",
  );
  assert.match(
    gatewayWorkflowDependencyViolations(withoutInstall).join("\n"),
    /locked source-policy dependencies/,
  );
});
