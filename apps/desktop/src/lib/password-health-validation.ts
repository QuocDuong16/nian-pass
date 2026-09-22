import type {
  PasswordHealthIssueDto,
  PasswordHealthReportDto,
} from "../types/desktop";
import {
  invalidContract,
  nonEmptyString,
  parseSummaryText,
  record,
} from "./validation-primitives";

function nonNegativeSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalidContract();
  }
  return value;
}

function positiveSafeInteger(value: unknown): number {
  const parsed = nonNegativeSafeInteger(value);
  return parsed > 0 ? parsed : invalidContract();
}

function parseIssue(value: unknown): PasswordHealthIssueDto {
  const object = record(value, [
    "entryId",
    "groupId",
    "title",
    "missingPassword",
    "emptyPassword",
    "reusedPassword",
    "belowMinimumLength",
    "weakPassword",
    "strengthScore",
  ]);
  const flags = [
    object["missingPassword"],
    object["emptyPassword"],
    object["reusedPassword"],
    object["belowMinimumLength"],
    object["weakPassword"],
  ];
  if (flags.some((flag) => typeof flag !== "boolean")) {
    return invalidContract();
  }
  const [
    missingPassword,
    emptyPassword,
    reusedPassword,
    belowMinimumLength,
    weakPassword,
  ] = flags as [boolean, boolean, boolean, boolean, boolean];
  const rawStrengthScore = object["strengthScore"];
  const strengthScore =
    rawStrengthScore === null ? null : nonNegativeSafeInteger(rawStrengthScore);
  if (strengthScore !== null && strengthScore > 4) return invalidContract();
  if (
    !flags.some(Boolean) ||
    (missingPassword &&
      (emptyPassword ||
        reusedPassword ||
        belowMinimumLength ||
        weakPassword ||
        strengthScore !== null)) ||
    (emptyPassword &&
      (missingPassword ||
        reusedPassword ||
        belowMinimumLength ||
        weakPassword)) ||
    (!missingPassword && strengthScore === null)
  ) {
    return invalidContract();
  }
  return {
    entryId: nonEmptyString(object["entryId"]),
    groupId: nonEmptyString(object["groupId"]),
    title: parseSummaryText(object["title"]),
    missingPassword,
    emptyPassword,
    reusedPassword,
    belowMinimumLength,
    weakPassword,
    strengthScore,
  };
}

export function parsePasswordHealthReport(
  value: unknown,
): PasswordHealthReportDto {
  const object = record(value, [
    "totalEntries",
    "passwordEntries",
    "minimumLength",
    "weakScoreThreshold",
    "issues",
  ]);
  if (!Array.isArray(object["issues"])) return invalidContract();
  const totalEntries = nonNegativeSafeInteger(object["totalEntries"]);
  const passwordEntries = nonNegativeSafeInteger(object["passwordEntries"]);
  if (passwordEntries > totalEntries) return invalidContract();
  const issues = object["issues"].map(parseIssue);
  if (issues.length > totalEntries) return invalidContract();
  const weakScoreThreshold = positiveSafeInteger(object["weakScoreThreshold"]);
  if (weakScoreThreshold > 4) return invalidContract();
  for (const issue of issues) {
    if (issue.missingPassword || issue.emptyPassword) continue;
    if (issue.strengthScore === null) return invalidContract();
    if (issue.strengthScore < weakScoreThreshold !== issue.weakPassword) {
      return invalidContract();
    }
  }
  return {
    totalEntries,
    passwordEntries,
    minimumLength: positiveSafeInteger(object["minimumLength"]),
    weakScoreThreshold,
    issues,
  };
}
