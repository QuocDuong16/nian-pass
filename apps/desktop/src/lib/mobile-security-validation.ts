import type {
  MobileSecurityAcknowledgementDto,
  MobileSecurityResumeDto,
} from "../types/mobile";

function exactRecord(value: unknown, keys: readonly string[]) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid mobile security response");
  }
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(object, key))
  ) {
    throw new Error("invalid mobile security response");
  }
  return object;
}

export function parseMobileSecurityResume(
  value: unknown,
): MobileSecurityResumeDto {
  const object = exactRecord(value, [
    "foreground",
    "elapsedRealtimeMs",
    "generation",
    "screenState",
    "curtainVisible",
    "vaultState",
    "operationPending",
  ]);
  const elapsedRealtimeMs = object["elapsedRealtimeMs"];
  const generation = object["generation"];
  const screenState = object["screenState"];
  const vaultState = object["vaultState"];
  if (
    typeof object["foreground"] !== "boolean" ||
    typeof object["curtainVisible"] !== "boolean" ||
    typeof object["operationPending"] !== "boolean" ||
    typeof elapsedRealtimeMs !== "number" ||
    !Number.isSafeInteger(elapsedRealtimeMs) ||
    elapsedRealtimeMs < 0 ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    (screenState !== "active" &&
      screenState !== "screen_off" &&
      screenState !== "device_locked") ||
    (vaultState !== "locked" &&
      vaultState !== "clean" &&
      vaultState !== "dirty")
  ) {
    throw new Error("invalid mobile security response");
  }
  return {
    foreground: object["foreground"],
    elapsedRealtimeMs,
    generation,
    screenState,
    curtainVisible: object["curtainVisible"],
    vaultState,
    operationPending: object["operationPending"],
  };
}

export function parseMobileSecurityAcknowledgement(
  value: unknown,
): MobileSecurityAcknowledgementDto {
  const object = exactRecord(value, ["acknowledged"]);
  if (typeof object["acknowledged"] !== "boolean") {
    throw new Error("invalid mobile security acknowledgement");
  }
  return { acknowledged: object["acknowledged"] };
}
