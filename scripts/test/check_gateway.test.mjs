import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  forbiddenRuntimeDependencies,
  forgejoNodeArchivePinViolations,
  gatewayContainerNetworkProbeViolations,
  gatewaySecretBuildContextViolations,
  gatewayWorkflowDependencyViolations,
  protocolSourceViolations,
} from "../check_gateway.mjs";

test("all Forgejo Node bootstrap jobs pin upstream hashes and verify before extracting", () => {
  const workflow = readFileSync(
    new URL("../../.forgejo/workflows/quality.yml", import.meta.url),
    "utf8",
  );
  assert.deepEqual(forgejoNodeArchivePinViolations(workflow), []);

  const staleX64 = workflow.replace(
    "3e301118d7df53d563b7e96c1617545f26e2f76f9724be668d6cab65c15dda5d",
    "982aa24dd8be4c889c6a8ab337ddff3b0896645b20f4239356e80552c16277ee",
  );
  assert.match(
    forgejoNodeArchivePinViolations(staleX64).join("\n"),
    /rust: Node.js x64 archive SHA-256/,
  );

  const staleArm64 = workflow.replace(
    "23c1b4d19e2f12a7d06fe8aa3d6e0e4923cf77a47e13c5ccdf32fadaa33960f2",
    "afc7a004018485092ac8985b817b0d5684472bd9472e0b57d2ab88737e50090d",
  );
  assert.match(
    forgejoNodeArchivePinViolations(staleArm64).join("\n"),
    /rust: Node.js arm64 archive SHA-256/,
  );

  const skipVerification = workflow.replace(
    "sha256sum --check -",
    ": checksum skipped",
  );
  assert.match(
    forgejoNodeArchivePinViolations(skipVerification).join("\n"),
    /rust: Node.js download must be checksum-verified before extraction/,
  );
});

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
          node_version="26.8.1"
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
