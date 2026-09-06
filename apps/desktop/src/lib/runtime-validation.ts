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

function isReleaseVersion(value: string): boolean {
  if (value.length === 0 || value.length > 128) return false;
  const separator = value.indexOf("-");
  const core = separator === -1 ? value : value.slice(0, separator);
  const prerelease = separator === -1 ? undefined : value.slice(separator + 1);
  const numeric = core.split(".");
  const isDigit = (character: string) => character >= "0" && character <= "9";
  const everyCharacter = (
    input: string,
    predicate: (character: string) => boolean,
  ) => {
    for (const character of input) {
      if (!predicate(character)) return false;
    }
    return true;
  };
  if (
    numeric.length !== 3 ||
    numeric.some(
      (component) =>
        component.length === 0 || !everyCharacter(component, isDigit),
    )
  ) {
    return false;
  }
  return (
    prerelease === undefined ||
    (prerelease.length > 0 &&
      everyCharacter(
        prerelease,
        (character) =>
          isDigit(character) ||
          (character >= "A" && character <= "Z") ||
          (character >= "a" && character <= "z") ||
          character === "." ||
          character === "-",
      ))
  );
}

export function parseRuntimeInfo(value: unknown): RuntimeInfoDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidRuntimeInfo();
  }
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== 3 ||
    !("platform" in object) ||
    typeof object["version"] !== "string" ||
    !isReleaseVersion(object["version"]) ||
    typeof object["commit"] !== "string" ||
    !/^(?:unknown|[0-9a-f]{40})$/.test(object["commit"])
  ) {
    return invalidRuntimeInfo();
  }
  return {
    platform: parseRuntimePlatform(object["platform"]),
    version: object["version"],
    commit: object["commit"],
  };
}
