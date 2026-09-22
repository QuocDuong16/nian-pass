import { expect, test } from "vitest";

import {
  formatExpiryDisplay,
  formatExpiryInput,
  isEntryExpired,
  parseExpiryInput,
} from "./entry-expiry";

test("expiry datetime input round-trips whole minutes", () => {
  const timestamp = 1_893_456_000;
  expect(parseExpiryInput(formatExpiryInput(timestamp))).toBe(timestamp);
  expect(parseExpiryInput("")).toBeNull();
  expect(parseExpiryInput("not-a-date")).toBeNull();
});

test("expiry status uses an explicit comparison instant", () => {
  expect(isEntryExpired(100, 100)).toBe(true);
  expect(isEntryExpired(101, 100)).toBe(false);
});

test("expiry display rejects timestamps outside the JavaScript Date range", () => {
  expect(formatExpiryDisplay(1_893_456_000)).not.toBe("Invalid expiry");
  expect(formatExpiryDisplay(Number.MAX_SAFE_INTEGER)).toBe("Invalid expiry");
  expect(formatExpiryInput(null)).toBe("");
});
