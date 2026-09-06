import assert from "node:assert/strict";
import { test } from "node:test";

import { deterministicZip } from "../../apps/browser-extension/build/package.mjs";

test("browser ZIP bytes are deterministic", () => {
  const entries = [
    { name: "a.txt", bytes: Buffer.from("alpha") },
    { name: "nested/b.txt", bytes: Buffer.from("beta") },
  ];
  const first = deterministicZip(entries);
  const second = deterministicZip(entries);
  assert.deepEqual(first, second);
  assert.equal(first.readUInt32LE(0), 0x04034b50);
  assert.equal(first.readUInt32LE(first.length - 22), 0x06054b50);
});
