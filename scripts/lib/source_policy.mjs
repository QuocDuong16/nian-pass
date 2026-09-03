import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function projectPath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

export function frontendProductionFiles(root) {
  return walk(resolve(root, "apps/desktop/src")).filter((path) => {
    const name = projectPath(root, path);
    return (
      /\.(?:ts|tsx)$/.test(name) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/.test(name) &&
      !name.endsWith(".d.ts") &&
      !name.includes("/test/")
    );
  });
}

export function rustProductionFiles(root) {
  const roots = [
    "apps/cli/src",
    "apps/desktop/src-tauri/src",
    "crates/kdbx/src",
    "crates/sync-engine/src",
    "crates/sync-provider-core/src",
    "crates/sync-provider-s3/src",
    "crates/sync-provider-webdav/src",
    "crates/vault-core/src",
    "crates/vault-session/src",
    "crates/vault-sync/src",
    "crates/windows-safe-replace/src",
  ];
  return roots.flatMap((directory) => {
    const path = resolve(root, directory);
    return existsSync(path)
      ? walk(path).filter((candidate) => candidate.endsWith(".rs"))
      : [];
  });
}

function rustItemEnd(source, start) {
  let opening = -1;
  let state = "normal";
  let blockCommentDepth = 0;
  let braceDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (char === "\n") state = "normal";
      continue;
    }
    if (state === "block-comment") {
      if (char === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) state = "normal";
      }
      continue;
    }
    if (state === "string" || state === "char") {
      if (char === "\\") {
        index += 1;
      } else if (
        (state === "string" && char === '"') ||
        (state === "char" && char === "'")
      ) {
        state = "normal";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      state = "block-comment";
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (char === '"') {
      state = "string";
      continue;
    }
    if (char === "'" && /^'(?:\\.|[^\\'\n])'/.test(source.slice(index))) {
      state = "char";
      continue;
    }
    if (opening === -1 && char === ";") return index + 1;
    if (char === "{") {
      if (opening === -1) opening = index;
      braceDepth += 1;
    } else if (char === "}" && opening !== -1) {
      braceDepth -= 1;
      if (braceDepth === 0) return index + 1;
    }
  }
  return source.length;
}

function cfgTestRanges(source) {
  const ranges = [];
  for (const match of source.matchAll(/^[ \t]*#\[cfg\(test\)\][ \t]*$/gm)) {
    const start = match.index;
    const end = rustItemEnd(source, start + match[0].length);
    ranges.push([start, end]);
  }
  return ranges;
}

export function withoutRustTestItems(source, preserveLines = false) {
  const ranges = cfgTestRanges(source);
  let output = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    output += source.slice(cursor, start);
    const removed = source.slice(start, end);
    output += preserveLines ? removed.replace(/[^\n]/g, " ") : "";
    cursor = end;
  }
  return output + source.slice(cursor);
}

export function readRustProduction(path, preserveLines = true) {
  return withoutRustTestItems(readFileSync(path, "utf8"), preserveLines);
}

export function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}
