import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { parse as parseToml } from "smol-toml";

const exactToolchainVersion = /^\d+\.\d+\.\d+$/;

export function pinnedRustVersion(miseContents) {
  let mise;
  try {
    mise = parseToml(miseContents);
  } catch {
    throw new Error("Could not read the pinned Rust version");
  }
  const rust = mise.tools?.rust;
  if (typeof rust !== "string" || !exactToolchainVersion.test(rust)) {
    throw new Error("Could not read the pinned Rust version");
  }
  return rust;
}

function main() {
  const [misePath] = process.argv.slice(2);
  if (!misePath || process.argv.length !== 3) {
    throw new Error("Could not read the pinned Rust version");
  }
  process.stdout.write(`${pinnedRustVersion(readFileSync(misePath, "utf8"))}\n`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Release toolchain pin check failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
