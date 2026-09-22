import { expect, test } from "vitest";

import { parsePasswordHealthReport } from "./password-health-validation";

const valid = {
  totalEntries: 2,
  passwordEntries: 1,
  minimumLength: 12,
  weakScoreThreshold: 3,
  issues: [
    {
      entryId: "entry-a",
      groupId: "group-a",
      title: { kind: "protected" },
      missingPassword: false,
      emptyPassword: false,
      reusedPassword: true,
      belowMinimumLength: true,
      weakPassword: true,
      strengthScore: 2,
    },
  ],
};

test("password health parser accepts reviewed metadata only", () => {
  expect(parsePasswordHealthReport(valid)).toEqual(valid);

  for (const value of [
    { ...valid, passwordEntries: 3 },
    { ...valid, minimumLength: 0 },
    { ...valid, weakScoreThreshold: 0 },
    { ...valid, weakScoreThreshold: 5 },
    { ...valid, totalEntries: Number.MAX_SAFE_INTEGER + 1 },
    {
      ...valid,
      issues: [{ ...valid.issues[0], password: "must-not-cross-ipc" }],
    },
    {
      ...valid,
      issues: [
        {
          ...valid.issues[0],
          missingPassword: true,
          reusedPassword: true,
        },
      ],
    },
    {
      ...valid,
      issues: [
        {
          ...valid.issues[0],
          reusedPassword: false,
          belowMinimumLength: false,
          weakPassword: false,
          strengthScore: 4,
        },
      ],
    },
    {
      ...valid,
      issues: [{ ...valid.issues[0], strengthScore: 5 }],
    },
    {
      ...valid,
      issues: [{ ...valid.issues[0], weakPassword: false, strengthScore: 1 }],
    },
    {
      ...valid,
      issues: [
        {
          ...valid.issues[0],
          missingPassword: true,
          reusedPassword: false,
          belowMinimumLength: false,
          weakPassword: false,
          strengthScore: 0,
        },
      ],
    },
  ]) {
    expect(() => parsePasswordHealthReport(value)).toThrow(
      "Nian Pass received an invalid desktop contract",
    );
  }
});
