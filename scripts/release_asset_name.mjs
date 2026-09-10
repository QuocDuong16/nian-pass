import { basename } from "node:path";

/** Canonicalize payload names before release integrity metadata is generated. */
export function canonicalReleaseAssetName(name) {
  if (typeof name !== "string" || name.length === 0 || basename(name) !== name) {
    throw new Error("release asset name must be one non-empty basename");
  }
  const canonical = name.replaceAll(" ", ".");
  if (/\s/u.test(canonical)) {
    throw new Error(`canonical release asset filename contains whitespace: ${name}`);
  }
  return canonical;
}
