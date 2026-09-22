import type { EntryIconDto } from "../types/desktop";
import { invalidContract, record } from "./validation-primitives";

const MAX_STANDARD_ICON_ID = 68;

export function parseEntryIcon(value: unknown): EntryIconDto {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return invalidContract();
  }
  const kind = value.kind;
  if (kind === "built_in") {
    const object = record(value, ["kind", "id"]);
    const id = object["id"];
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      id < 0 ||
      id > MAX_STANDARD_ICON_ID
    ) {
      return invalidContract();
    }
    return { kind: "built_in", id };
  }
  if (kind === "none" || kind === "custom" || kind === "non_standard") {
    record(value, ["kind"]);
    return { kind };
  }
  return invalidContract();
}
