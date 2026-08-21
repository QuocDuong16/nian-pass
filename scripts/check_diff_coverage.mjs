import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { withoutRustTestItems } from "./lib/source_policy.mjs";

function parseArgs(argv) {
  const args = {
    file: null,
    threshold: null,
    path: null,
    extensions: [],
    base: null,
    requireBase: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-base") args.requireBase = true;
    else if (argument === "--file") args.file = argv[++index];
    else if (argument === "--threshold") args.threshold = Number(argv[++index]);
    else if (argument === "--path") args.path = argv[++index];
    else if (argument === "--extension") args.extensions.push(argv[++index]);
    else if (argument === "--base") args.base = argv[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!args.file) throw new Error("--file is required");
  if (!Number.isFinite(args.threshold) || args.threshold < 0 || args.threshold > 100) {
    throw new Error("--threshold must be between 0 and 100");
  }
  if (!args.path) throw new Error("--path is required");
  if (args.extensions.length === 0) throw new Error("at least one --extension is required");
  return args;
}

function git(arguments_, cwd) {
  return execFileSync("git", ["--no-pager", ...arguments_], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolveBase(base, requireBase, cwd = process.cwd()) {
  const candidates = base ? [base, `origin/${base}`] : ["origin/main", "main"];
  for (const candidate of candidates) {
    if (/^0+$/.test(candidate)) continue;
    try {
      return git(["rev-parse", "--verify", `${candidate}^{commit}`], cwd);
    } catch {
      // Try the next explicitly documented fallback.
    }
  }
  if (requireBase) {
    throw new Error(
      `cannot resolve coverage base (tried: ${candidates.join(", ")}); fetch it before running CI`,
    );
  }
  console.warn(
    `Changed-line coverage: no base found (tried: ${candidates.join(", ")}); local gate skipped.`,
  );
  return null;
}

function parseChangedLines(diff) {
  const lines = new Set();
  for (const line of diff.split(/\r?\n/)) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (match === null) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
  }
  return lines;
}

function changedFiles(base, path, cwd = process.cwd()) {
  const output = git(["diff", "--name-only", "--diff-filter=ACMR", base, "--", path], cwd);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", path], cwd);
  return [...new Set([
    ...(output === "" ? [] : output.split("\n")),
    ...(untracked === "" ? [] : untracked.split("\n")),
  ])];
}

function changedLineNumbers(base, file, cwd = process.cwd()) {
  try {
    git(["ls-files", "--error-unmatch", "--", file], cwd);
  } catch {
    const count = readFileSync(resolve(cwd, file), "utf8").split(/\r?\n/).length;
    return new Set(Array.from({ length: count }, (_, index) => index + 1));
  }
  return parseChangedLines(git(["diff", "--unified=0", base, "--", file], cwd));
}

function parseLcov(reportPath, pathPrefix) {
  const coverage = new Map();
  let currentFile = null;
  let currentLines = null;
  const prefix = `${pathPrefix.replace(/\/$/, "")}/`;
  for (const line of readFileSync(reportPath, "utf8").split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      const file = line.slice(3).replaceAll("\\", "/");
      const index = file.indexOf(prefix);
      const normalized = file.replace(/^\.\//, "");
      currentFile =
        index !== -1
          ? file.slice(index)
          : normalized.startsWith(prefix)
            ? normalized
            : `${prefix}${normalized}`;
      currentLines = new Map();
    } else if (line.startsWith("DA:") && currentLines !== null) {
      const [lineNumber, hits] = line.slice(3).split(",");
      currentLines.set(Number(lineNumber), Number(hits));
    } else if (line === "end_of_record" && currentFile !== null) {
      coverage.set(currentFile, currentLines);
      currentFile = null;
      currentLines = null;
    }
  }
  return coverage;
}

function isExcluded(file) {
  return (
    file.includes("/test/") ||
    file.includes("/tests/") ||
    file.includes("/types/") ||
    file.includes("/generated/") ||
    file.endsWith(".d.ts") ||
    file.endsWith("build.rs") ||
    /\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/.test(file) ||
    /(?:^|\/)(?:vite|vitest|eslint|prettier)\.config\./.test(file)
  );
}

function evaluateChangedLines(changed, coverage) {
  let covered = 0;
  let total = 0;
  const uncovered = [];
  for (const line of [...changed].sort((left, right) => left - right)) {
    const hits = coverage.get(line);
    if (hits === undefined) continue;
    total += 1;
    if (hits > 0) covered += 1;
    else if (uncovered.length < 10) uncovered.push(line);
  }
  return {
    covered,
    total,
    uncovered,
    percent: total === 0 ? null : (covered * 100) / total,
  };
}

function rustProductionLines(file, changed, cwd = process.cwd()) {
  if (!file.endsWith(".rs")) return changed;
  const source = withoutRustTestItems(readFileSync(resolve(cwd, file), "utf8"), true);
  const lines = source.split(/\r?\n/);
  return new Set([...changed].filter((line) => lines[line - 1]?.trim() !== ""));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = resolveBase(args.base, args.requireBase);
  if (base === null) return;
  if (!existsSync(args.file)) throw new Error(`coverage report not found: ${args.file}`);

  const coverage = parseLcov(args.file, args.path);
  const extensionPattern = new RegExp(
    `\\.(?:${args.extensions.map((extension) => extension.replace(/^\./, "")).join("|")})$`,
  );
  const files = changedFiles(base, args.path)
    .filter((file) => extensionPattern.test(file))
    .filter((file) => !isExcluded(file));
  if (files.length === 0) {
    console.log("Changed-line coverage passed: no production source changes to check.");
    return;
  }

  const failures = [];
  for (const file of files) {
    const fileCoverage = coverage.get(file);
    if (fileCoverage === undefined) {
      failures.push(`${file}: absent from coverage report`);
      continue;
    }
    const changed = rustProductionLines(file, changedLineNumbers(base, file));
    const result = evaluateChangedLines(changed, fileCoverage);
    if (result.percent === null) {
      console.log(`${file}: no executable production lines changed`);
      continue;
    }
    console.log(
      `${file}: ${result.percent.toFixed(1)}% (${result.covered}/${result.total} changed lines)`,
    );
    if (result.percent < args.threshold) {
      failures.push(
        `${file}: ${result.percent.toFixed(1)}% is below ${args.threshold}%` +
          (result.uncovered.length > 0 ? `; uncovered lines ${result.uncovered.join(", ")}` : ""),
      );
    }
  }
  if (failures.length > 0) {
    process.stderr.write(
      `Changed-line coverage failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    console.log(`Changed-line coverage passed at ${args.threshold}% or higher.`);
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

export {
  changedFiles,
  changedLineNumbers,
  evaluateChangedLines,
  isExcluded,
  parseArgs,
  parseChangedLines,
  parseLcov,
  resolveBase,
  rustProductionLines,
};
