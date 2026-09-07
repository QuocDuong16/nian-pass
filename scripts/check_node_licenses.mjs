import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const allowedLicenses = new Set(["Apache-2.0 OR MIT", "MIT", "MPL-2.0"]);

export function licenseViolations(report, allowed = allowedLicenses) {
  const violations = [];
  for (const [license, packages] of Object.entries(report ?? {})) {
    if (allowed.has(license)) continue;
    for (const dependency of packages) {
      const versions = Array.isArray(dependency.versions)
        ? dependency.versions.join(",")
        : "unknown";
      violations.push(`${dependency.name}@${versions}: unapproved license ${license}`);
    }
  }
  return violations.sort();
}

function main() {
  const result = spawnSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    throw new Error(
      `pnpm license inventory failed: ${stderr || result.error?.message || stdout || `exit ${String(result.status)}`}`,
    );
  }
  const violations = licenseViolations(JSON.parse(result.stdout));
  if (violations.length > 0) throw new Error(violations.join("\n"));
  process.stdout.write("Production Node dependency license check passed.\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Node license check failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
