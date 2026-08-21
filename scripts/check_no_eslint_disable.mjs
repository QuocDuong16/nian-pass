import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  frontendProductionFiles,
  lineNumberAt,
  projectPath,
} from "./lib/source_policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const disablePattern = /eslint-disable(?:-next-line|-line)?/g;

export function runChecks(root) {
  const violations = [];
  for (const path of frontendProductionFiles(root)) {
    const source = readFileSync(path, "utf8");
    const name = projectPath(root, path);
    for (const match of source.matchAll(disablePattern)) {
      violations.push(
        `${name}:${lineNumberAt(source, match.index)}: production eslint-disable comments are forbidden`,
      );
    }
  }
  return violations;
}

function main() {
  const violations = runChecks(repositoryRoot);
  if (violations.length > 0) {
    process.stderr.write(`${violations.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("No production eslint-disable comments found.\n");
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
