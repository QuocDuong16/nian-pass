import { posix } from "node:path";

function stripPbxComments(source) {
  let result = "";
  let index = 0;
  let quote = false;

  while (index < source.length) {
    const pair = source.slice(index, index + 2);
    const character = source[index];
    if (quote) {
      result += character;
      if (character === "\\" && index + 1 < source.length) {
        result += source[index + 1];
        index += 2;
      } else {
        if (character === '"') quote = false;
        index += 1;
      }
    } else if (character === '"') {
      quote = true;
      result += character;
      index += 1;
    } else if (pair === "//") {
      result += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        result += " ";
        index += 1;
      }
    } else if (pair === "/*") {
      result += "  ";
      index += 2;
      while (index < source.length && source.slice(index, index + 2) !== "*/") {
        result += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index >= source.length)
        throw new Error("Xcode project contains an unterminated comment");
      result += "  ";
      index += 2;
    } else {
      result += character;
      index += 1;
    }
  }
  if (quote)
    throw new Error("Xcode project contains an unterminated quoted value");
  return result;
}

function tokens(source) {
  const result = [];
  const punctuation = new Set(["{", "}", "(", ")", "=", ";", ","]);
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) {
      index += 1;
    } else if (punctuation.has(character)) {
      result.push(character);
      index += 1;
    } else if (character === '"') {
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\\" && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (index >= source.length)
        throw new Error("Xcode project contains an unterminated quoted value");
      result.push(value);
      index += 1;
    } else {
      const start = index;
      while (
        index < source.length &&
        !/\s/u.test(source[index]) &&
        !punctuation.has(source[index]) &&
        source[index] !== '"'
      ) {
        index += 1;
      }
      if (start === index)
        throw new Error(
          `Xcode project contains unsupported syntax near offset ${index}`,
        );
      result.push(source.slice(start, index));
    }
  }
  return result;
}

function parseProject(source) {
  const input = tokens(stripPbxComments(source));
  let cursor = 0;

  function take(expected) {
    const value = input[cursor];
    if (value === undefined || (expected !== undefined && value !== expected)) {
      throw new Error(
        `Xcode project expected ${expected ?? "a value"} near token ${cursor}`,
      );
    }
    cursor += 1;
    return value;
  }

  function parseValue() {
    if (input[cursor] === "{") {
      take("{");
      const value = {};
      while (input[cursor] !== "}") {
        const key = take();
        take("=");
        if (Object.hasOwn(value, key)) {
          throw new Error(
            `Xcode project contains duplicate object or field ${key}`,
          );
        }
        value[key] = parseValue();
        take(";");
      }
      take("}");
      return value;
    }
    if (input[cursor] === "(") {
      take("(");
      const value = [];
      while (input[cursor] !== ")") {
        value.push(parseValue());
        if (input[cursor] === ",") take(",");
      }
      take(")");
      return value;
    }
    return take();
  }

  const project = parseValue();
  if (
    cursor !== input.length ||
    Array.isArray(project) ||
    typeof project !== "object"
  ) {
    throw new Error("Xcode project root must be one OpenStep dictionary");
  }
  return project;
}

function arrayField(object, field, description) {
  const value = object[field];
  if (!Array.isArray(value))
    throw new Error(`${description} has malformed ${field}`);
  return value;
}

function confinedPath(path, description) {
  if (path.includes("$(") || posix.isAbsolute(path)) {
    throw new Error(
      `${description} uses an unsupported or absolute path: ${path}`,
    );
  }
  const normalized = posix.normalize(path);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(
      `${description} resolves outside the Apple project: ${path}`,
    );
  }
  return normalized;
}

function sourcePaths(project, targetId, target) {
  const objects = project.objects;
  const rootObject = objects?.[project.rootObject];
  if (
    !objects ||
    typeof objects !== "object" ||
    !rootObject ||
    rootObject.isa !== "PBXProject"
  ) {
    throw new Error("Xcode project object graph or root PBXProject is missing");
  }
  const phases = arrayField(target, "buildPhases", "Credential Provider target")
    .map((id) => [id, objects[id]])
    .filter(([, phase]) => phase?.isa === "PBXSourcesBuildPhase");
  if (phases.length === 0)
    throw new Error("Credential Provider target has no PBXSourcesBuildPhase");
  if (phases.length > 1)
    throw new Error(
      "Credential Provider target has multiple PBXSourcesBuildPhase objects",
    );

  const parents = new Map();
  for (const [groupId, group] of Object.entries(objects)) {
    if (group?.isa !== "PBXGroup") continue;
    for (const child of arrayField(group, "children", `PBXGroup ${groupId}`)) {
      const existing = parents.get(child) ?? [];
      existing.push(groupId);
      parents.set(child, existing);
    }
  }

  function groupPath(groupId, seen = new Set()) {
    if (seen.has(groupId))
      throw new Error(`PBXGroup cycle prevents resolving ${groupId}`);
    const group = objects[groupId];
    if (!group || group.isa !== "PBXGroup")
      throw new Error(`Swift source parent ${groupId} is not a PBXGroup`);
    const nextSeen = new Set(seen).add(groupId);
    const ownPath = group.path ?? "";
    const sourceTree = group.sourceTree ?? "<group>";
    if (sourceTree === "SOURCE_ROOT")
      return confinedPath(ownPath || ".", `PBXGroup ${groupId}`);
    if (sourceTree !== "<group>")
      throw new Error(
        `PBXGroup ${groupId} uses unsupported sourceTree ${sourceTree}`,
      );
    const parentIds = parents.get(groupId) ?? [];
    if (parentIds.length === 0) {
      if (groupId !== rootObject.mainGroup)
        throw new Error(
          `PBXGroup ${groupId} has no unambiguous project-relative parent`,
        );
      return confinedPath(ownPath || ".", `PBXGroup ${groupId}`);
    }
    if (parentIds.length !== 1)
      throw new Error(`PBXGroup ${groupId} has ambiguous parents`);
    return confinedPath(
      posix.join(groupPath(parentIds[0], nextSeen), ownPath),
      `PBXGroup ${groupId}`,
    );
  }

  function filePath(fileId, file) {
    const ownPath = file.path ?? file.name;
    if (!ownPath)
      throw new Error(`PBXFileReference ${fileId} has no path or name`);
    const sourceTree = file.sourceTree ?? "<group>";
    if (sourceTree === "SOURCE_ROOT")
      return confinedPath(ownPath, `PBXFileReference ${fileId}`);
    if (sourceTree !== "<group>")
      throw new Error(
        `PBXFileReference ${fileId} uses unsupported sourceTree ${sourceTree}`,
      );
    const parentIds = parents.get(fileId) ?? [];
    if (parentIds.length !== 1)
      throw new Error(
        `PBXFileReference ${fileId} has no unambiguous parent group`,
      );
    return confinedPath(
      posix.join(groupPath(parentIds[0]), ownPath),
      `PBXFileReference ${fileId}`,
    );
  }

  const paths = [];
  for (const buildFileId of arrayField(
    phases[0][1],
    "files",
    "Credential Provider PBXSourcesBuildPhase",
  )) {
    const buildFile = objects[buildFileId];
    if (!buildFile || buildFile.isa !== "PBXBuildFile") {
      throw new Error(
        `Credential Provider target references unknown PBXBuildFile ${buildFileId}`,
      );
    }
    const file = objects[buildFile.fileRef];
    if (!file || file.isa !== "PBXFileReference") {
      throw new Error(
        `Credential Provider target references unresolved source file ${buildFile.fileRef ?? "<missing>"}`,
      );
    }
    const path = filePath(buildFile.fileRef, file);
    if (path.endsWith(".swift")) paths.push(path);
  }
  if (paths.length === 0)
    throw new Error(
      `Credential Provider target ${targetId} has no Swift sources in PBXSourcesBuildPhase`,
    );
  if (new Set(paths).size !== paths.length)
    throw new Error(
      "Credential Provider target contains duplicate Swift source references",
    );
  return paths;
}

export function credentialProviderSwiftPaths(sources) {
  const projects = (Array.isArray(sources) ? sources : [sources]).map(
    parseProject,
  );
  const targets = [];
  for (const project of projects) {
    const objects = project.objects;
    const rootObject = objects?.[project.rootObject];
    if (
      !objects ||
      typeof objects !== "object" ||
      !rootObject ||
      rootObject.isa !== "PBXProject"
    ) {
      throw new Error(
        "Xcode project object graph or root PBXProject is missing",
      );
    }
    for (const id of arrayField(rootObject, "targets", "PBXProject")) {
      const object = objects[id];
      if (!object)
        throw new Error(`PBXProject references unknown target ${id}`);
      if (
        object?.isa === "PBXNativeTarget" &&
        object.productType === "com.apple.product-type.app-extension"
      ) {
        targets.push({ id, object, project });
      }
    }
  }
  if (targets.length !== 1) {
    throw new Error(
      `iOS Xcode build graph must contain exactly one app-extension PBXNativeTarget; found ${targets.length}`,
    );
  }
  const [{ id, object, project }] = targets;
  const product = project.objects?.[object.productReference];
  const productPath = product?.path ?? product?.name;
  if (
    !product ||
    product.isa !== "PBXFileReference" ||
    !productPath?.endsWith(".appex")
  ) {
    throw new Error(
      "Credential Provider PBXNativeTarget has an unresolved .appex product reference",
    );
  }
  return sourcePaths(project, id, object);
}

export { stripPbxComments };
