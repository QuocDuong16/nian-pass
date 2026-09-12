import type { SummaryTextDto } from "../types/desktop";

export function invalidContract(): never {
  throw new Error("Nian Pass received an invalid desktop contract");
}

export function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidContract();
  }
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return invalidContract();
  }
  return object;
}

export function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value === "") return invalidContract();
  return value;
}

export function stringValue(value: unknown): string {
  if (typeof value !== "string") return invalidContract();
  return value;
}

export function parseSummaryText(value: unknown): SummaryTextDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidContract();
  }
  const object = value as Record<string, unknown>;
  const kind = object["kind"];
  switch (kind) {
    case "missing":
      record(value, ["kind"]);
      return { kind };
    case "protected":
      record(value, ["kind"]);
      return { kind };
    case "visible": {
      const visible = record(value, ["kind", "value"]);
      return { kind, value: stringValue(visible["value"]) };
    }
    default:
      return invalidContract();
  }
}
