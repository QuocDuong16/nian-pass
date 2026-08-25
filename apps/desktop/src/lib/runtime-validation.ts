import type { RuntimeInfoDto, RuntimePlatform } from "../types/runtime";

function invalidRuntimeInfo(): never {
  throw new Error("Nian Pass received invalid runtime information");
}

function parseRuntimePlatform(value: unknown): RuntimePlatform {
  if (value === "desktop" || value === "android" || value === "ios") {
    return value;
  }
  return invalidRuntimeInfo();
}

export function parseRuntimeInfo(value: unknown): RuntimeInfoDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidRuntimeInfo();
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== 1 || !("platform" in object)) {
    return invalidRuntimeInfo();
  }
  return { platform: parseRuntimePlatform(object["platform"]) };
}
