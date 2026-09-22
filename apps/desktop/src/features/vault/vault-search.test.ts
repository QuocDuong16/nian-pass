import { expect, test } from "vitest";

import { mutationSnapshot } from "../../test/desktop-api";
import type { EntrySummaryDto, VaultSnapshotDto } from "../../types/desktop";
import { searchVault } from "./vault-search";

const NOW = 2_000_000_000;
const DAY = 24 * 60 * 60;
const original = mutationSnapshot.entries[0];
if (original === undefined) throw new Error("missing fixture");

const entries: EntrySummaryDto[] = [
  {
    ...original,
    id: "protected-expired",
    title: { kind: "protected" },
    username: { kind: "visible", value: "bank owner" },
    url: { kind: "missing" },
    groupId: "root",
    tags: ["Personal Finance", "bank"],
    totpPresent: true,
    notesPresent: false,
    expiresAtUnixSeconds: NOW,
  },
  {
    ...original,
    id: "expiring",
    title: { kind: "visible", value: "Bank account" },
    username: { kind: "missing" },
    url: { kind: "visible", value: "https://bank.example" },
    groupId: "work",
    tags: ["Work", "banking"],
    totpPresent: false,
    passwordPresent: true,
    notesPresent: true,
    expiresAtUnixSeconds: NOW + 30 * DAY,
  },
  {
    ...original,
    id: "later",
    title: { kind: "visible", value: "Personal Notes" },
    groupId: "root",
    tags: ["Personal Finance"],
    passwordPresent: false,
    totpPresent: true,
    expiresAtUnixSeconds: NOW + 31 * DAY,
  },
  {
    ...original,
    id: "deleted",
    title: { kind: "visible", value: "Bank in Trash" },
    groupId: "trash-child",
    tags: ["Personal Finance"],
    totpPresent: true,
    expiresAtUnixSeconds: NOW,
  },
];

const snapshot: VaultSnapshotDto = {
  ...mutationSnapshot,
  rootGroupId: "root",
  recycleBinGroupId: "trash",
  groups: [
    {
      id: "root",
      name: "Personal Accounts",
      childGroupIds: ["work", "trash"],
      entryIds: ["protected-expired", "later"],
    },
    {
      id: "work",
      name: "Work Accounts",
      childGroupIds: [],
      entryIds: ["expiring"],
    },
    {
      id: "trash",
      name: "Trash",
      childGroupIds: ["trash-child"],
      entryIds: [],
    },
    {
      id: "trash-child",
      name: "Nested Trash",
      childGroupIds: [],
      entryIds: ["deleted"],
    },
  ],
  entries,
};
const groups = new Map(snapshot.groups.map((group) => [group.id, group]));
const ids = (query: string) =>
  searchVault(snapshot, groups, query, NOW)?.map((item) => item.id);

test("blank query returns group view and ordinary text remains a substring search", () => {
  expect(searchVault(snapshot, groups, " \t ", NOW)).toBeNull();
  expect(ids("BANK ACCOUNT")).toEqual(["expiring"]);
  expect(ids("Personal Finance")).toEqual(["protected-expired", "later"]);
  expect(ids("bank in trash")).toEqual([]);
});

test("exact case-insensitive tag filters combine with free text and other filters", () => {
  expect(ids('tag:"personal finance" has:totp is:expired')).toEqual([
    "protected-expired",
  ]);
  expect(ids('bank tag:"PERSONAL FINANCE" has:totp')).toEqual([
    "protected-expired",
  ]);
  expect(ids("tag:bank")).toEqual(["protected-expired"]);
  expect(ids("tag:banking")).toEqual(["expiring"]);
  expect(ids("tag:bank has:notes")).toEqual([]);
  expect(ids('tag:"personal finance" bank owner')).toEqual([
    "protected-expired",
  ]);
});

test("group filters use group names and never match unrelated entry groups", () => {
  expect(ids('group:"Work Accounts" has:password')).toEqual(["expiring"]);
  expect(ids("group:accounts")).toEqual([
    "protected-expired",
    "expiring",
    "later",
  ]);
  expect(ids("group:work has:totp")).toEqual([]);
  expect(ids("group:trash")).toEqual([]);
});

test("presence and protection filters read boolean and opaque summary metadata only", () => {
  expect(ids("has:totp")).toEqual(["protected-expired", "later"]);
  expect(ids("has:password")).toEqual(["protected-expired", "expiring"]);
  expect(ids("has:notes")).toEqual(["expiring", "later"]);
  expect(ids("is:protected")).toEqual(["protected-expired"]);
  expect(ids("secret-password-plaintext")).toEqual([]);
});

test("expiry filters use explicit inclusive expiry and a future-only 30-day window", () => {
  expect(ids("is:expired")).toEqual(["protected-expired"]);
  expect(ids("is:expiring")).toEqual(["expiring"]);
  expect(ids("is:expired is:expiring")).toEqual([]);
  expect(ids("is:expiring has:totp")).toEqual([]);
  expect(searchVault(snapshot, groups, "is:expired", NOW - 1)).toEqual([]);
  expect(
    searchVault(snapshot, groups, "is:expiring", NOW - 1)?.map(
      (item) => item.id,
    ),
  ).toEqual(["protected-expired"]);
});

test("partial and malformed filters do not broaden matches or silently ignore text", () => {
  expect(ids("tag:")).toEqual([]);
  expect(ids("group:")).toEqual([]);
  expect(ids('tag:""')).toEqual([]);
  expect(ids('""')).toEqual([]);
  expect(ids('tag:"personal finance')).toEqual([]);
  expect(ids("has:unknown")).toEqual([]);
  expect(ids("is:unknown has:totp")).toEqual([]);
  expect(ids("tag:work group:work unknown")).toEqual([]);
});

test("all search modes exclude the recycle bin subtree", () => {
  expect(ids("has:totp")).not.toContain("deleted");
  expect(ids("is:expired")).not.toContain("deleted");
  expect(ids('tag:"personal finance"')).not.toContain("deleted");
  expect(ids("Trash")).toEqual([]);
});
