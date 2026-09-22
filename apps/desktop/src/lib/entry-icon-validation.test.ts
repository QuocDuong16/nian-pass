import { expect, test } from "vitest";

import { parseEntryIcon } from "./entry-icon-validation";

test("entry icon validation accepts reviewed metadata and rejects unsafe shapes", () => {
  expect(parseEntryIcon({ kind: "none" })).toEqual({ kind: "none" });
  expect(parseEntryIcon({ kind: "custom" })).toEqual({ kind: "custom" });
  expect(parseEntryIcon({ kind: "non_standard" })).toEqual({
    kind: "non_standard",
  });
  expect(parseEntryIcon({ kind: "built_in", id: 0 })).toEqual({
    kind: "built_in",
    id: 0,
  });
  expect(parseEntryIcon({ kind: "built_in", id: 68 })).toEqual({
    kind: "built_in",
    id: 68,
  });

  for (const value of [
    null,
    "built_in",
    { kind: "built_in", id: -1 },
    { kind: "built_in", id: 69 },
    { kind: "built_in", id: 1.5 },
    { kind: "built_in", id: "1" },
    { kind: "none", id: 0 },
    { kind: "unknown" },
  ]) {
    expect(() => parseEntryIcon(value)).toThrow("invalid desktop contract");
  }
});
