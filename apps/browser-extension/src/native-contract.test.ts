import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CHROMIUM_DEVELOPMENT_EXTENSION_ID,
  CHROMIUM_DEVELOPMENT_MANIFEST_KEY,
  FIREFOX_DEVELOPMENT_EXTENSION_ID,
  NATIVE_HOST_NAME,
} from "./native-identity";
import { parseNativeRequest, parseNativeResponse } from "./native-protocol";

test("committed Rust and TypeScript native contract fixtures validate exactly", () => {
  const path = resolve(
    import.meta.dirname,
    "../../../browser/native-contract-v1.json",
  );
  const contract = JSON.parse(readFileSync(path, "utf8")) as {
    version: number;
    hostName: string;
    chromiumDevelopment: { manifestKey: string; extensionId: string };
    firefoxDevelopmentExtensionId: string;
    fixtures: { requests: unknown[]; responses: unknown[] };
  };
  expect(contract.version).toBe(1);
  expect(contract.hostName).toBe(NATIVE_HOST_NAME);
  expect(contract.chromiumDevelopment).toEqual({
    manifestKey: CHROMIUM_DEVELOPMENT_MANIFEST_KEY,
    extensionId: CHROMIUM_DEVELOPMENT_EXTENSION_ID,
  });
  expect(contract.firefoxDevelopmentExtensionId).toBe(
    FIREFOX_DEVELOPMENT_EXTENSION_ID,
  );
  for (const request of contract.fixtures.requests) {
    expect(parseNativeRequest(request)).toEqual(request);
  }
  for (const response of contract.fixtures.responses) {
    expect(parseNativeResponse(response)).toEqual(response);
  }
});

test("native validators reject missing version, unknown type and unknown fields", () => {
  const request = {
    version: 1,
    type: "connect",
    requestId: "a".repeat(32),
  };
  expect(parseNativeRequest({ ...request, version: undefined })).toBeNull();
  expect(parseNativeRequest({ ...request, type: "associate" })).toBeNull();
  expect(parseNativeRequest({ ...request, extra: true })).toBeNull();
  expect(
    parseNativeResponse({
      version: 1,
      type: "error",
      requestId: "a".repeat(32),
      code: "rawRustDebug",
    }),
  ).toBeNull();
});
