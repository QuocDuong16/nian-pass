import { expect, test } from "vitest";

import type { EntrySummaryDto, SummaryTextDto } from "../../types/desktop";
import { sortEntriesForPresentation } from "./entry-sort";

function entry(
  id: string,
  title: SummaryTextDto,
  username: SummaryTextDto = { kind: "missing" },
  url: SummaryTextDto = { kind: "missing" },
): EntrySummaryDto {
  return {
    id,
    groupId: "group-a",
    title,
    username,
    url,
    passwordPresent: false,
    notesPresent: false,
    totpPresent: false,
    tags: [],
    expiresAtUnixSeconds: null,
    icon: { kind: "none" },
  };
}

test("database order is copied without mutation", () => {
  const entries = [
    entry("b", { kind: "visible", value: "Beta" }),
    entry("a", { kind: "visible", value: "Alpha" }),
  ];

  const sorted = sortEntriesForPresentation(entries, "database");

  expect(sorted.map(({ id }) => id)).toEqual(["b", "a"]);
  expect(sorted).not.toBe(entries);
});

test("title sort is case-insensitive, stable, and keeps unavailable values last", () => {
  const entries = [
    entry("protected", { kind: "protected" }),
    entry("beta", { kind: "visible", value: "beta" }),
    entry("alpha-upper", { kind: "visible", value: "Alpha" }),
    entry("empty", { kind: "visible", value: "" }),
    entry("alpha-lower", { kind: "visible", value: "alpha" }),
    entry("missing", { kind: "missing" }),
  ];

  expect(
    sortEntriesForPresentation(entries, "title_asc").map(({ id }) => id),
  ).toEqual([
    "alpha-upper",
    "alpha-lower",
    "beta",
    "empty",
    "protected",
    "missing",
  ]);
  expect(
    sortEntriesForPresentation(entries, "title_desc").map(({ id }) => id),
  ).toEqual([
    "beta",
    "alpha-upper",
    "alpha-lower",
    "empty",
    "protected",
    "missing",
  ]);
});

test("username and URL modes sort only visible metadata", () => {
  const entries = [
    entry(
      "two",
      { kind: "visible", value: "Second" },
      { kind: "visible", value: "zoe" },
      { kind: "visible", value: "https://z.example" },
    ),
    entry(
      "one",
      { kind: "visible", value: "First" },
      { kind: "visible", value: "amy" },
      { kind: "visible", value: "https://a.example" },
    ),
  ];

  expect(
    sortEntriesForPresentation(entries, "username_asc").map(({ id }) => id),
  ).toEqual(["one", "two"]);
  expect(
    sortEntriesForPresentation(entries, "url_asc").map(({ id }) => id),
  ).toEqual(["one", "two"]);
});

test("expiry mode sorts nearest timestamps first and keeps non-expiring entries last", () => {
  const entries = [
    entry("none", { kind: "visible", value: "No expiry" }),
    {
      ...entry("later", { kind: "visible", value: "Later" }),
      expiresAtUnixSeconds: 300,
    },
    {
      ...entry("early-a", { kind: "visible", value: "Early A" }),
      expiresAtUnixSeconds: 100,
    },
    {
      ...entry("early-b", { kind: "visible", value: "Early B" }),
      expiresAtUnixSeconds: 100,
    },
  ];

  expect(
    sortEntriesForPresentation(entries, "expiry_asc").map(({ id }) => id),
  ).toEqual(["early-a", "early-b", "later", "none"]);
});
