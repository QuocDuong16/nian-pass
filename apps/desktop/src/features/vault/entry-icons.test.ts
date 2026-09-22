import { expect, test } from "vitest";

import {
  STANDARD_ENTRY_ICONS,
  entryIconLabel,
  entryIconSelection,
  iconRequestFromSelection,
} from "./entry-icons";

test("standard icon catalog covers the complete KDBX range", () => {
  expect(STANDARD_ENTRY_ICONS).toHaveLength(69);
  expect(STANDARD_ENTRY_ICONS[0]).toEqual([0, "Password / key"]);
  expect(STANDARD_ENTRY_ICONS[68]).toEqual([68, "Mobile device"]);
});

test("icon presentation and edit selection stay explicit for every icon kind", () => {
  expect(entryIconLabel({ kind: "none" })).toBe("No explicit icon");
  expect(entryIconLabel({ kind: "built_in", id: 17 })).toBe("Optical media");
  expect(entryIconLabel({ kind: "custom" })).toBe("Custom icon");
  expect(entryIconLabel({ kind: "non_standard" })).toBe(
    "Non-standard built-in icon",
  );

  expect(entryIconSelection({ kind: "none" })).toBe("none");
  expect(entryIconSelection({ kind: "built_in", id: 68 })).toBe("built_in:68");
  expect(entryIconSelection({ kind: "custom" })).toBe("preserve");
  expect(entryIconSelection({ kind: "non_standard" })).toBe("preserve");
});

test("selection conversion emits only supported icon mutations", () => {
  expect(iconRequestFromSelection("preserve")).toBeUndefined();
  expect(iconRequestFromSelection("none")).toEqual({ kind: "none" });
  expect(iconRequestFromSelection("built_in:0")).toEqual({
    kind: "built_in",
    id: 0,
  });
  expect(iconRequestFromSelection("built_in:68")).toEqual({
    kind: "built_in",
    id: 68,
  });
  expect(iconRequestFromSelection("built_in:69")).toBeUndefined();
});
