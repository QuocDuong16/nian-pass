import assert from "node:assert/strict";
import { test } from "node:test";

import { licenseViolations } from "../check_node_licenses.mjs";

test("reviewed production Node licenses pass", () => {
  assert.deepEqual(
    licenseViolations({
      MIT: [{ name: "react", versions: ["19.2.8"] }],
      "MPL-2.0": [{ name: "webextension-polyfill", versions: ["0.12.0"] }],
      "Apache-2.0 OR MIT": [{ name: "@tauri-apps/api", versions: ["2.11.1"] }],
    }),
    [],
  );
});

test("unknown production Node licenses fail closed", () => {
  assert.deepEqual(
    licenseViolations({
      UNKNOWN: [{ name: "mystery", versions: ["1.0.0"] }],
    }),
    ["mystery@1.0.0: unapproved license UNKNOWN"],
  );
});
