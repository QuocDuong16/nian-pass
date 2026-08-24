import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { parse } from "smol-toml";

function projectPath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

function parseManifest(root, path) {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${projectPath(root, path)}: Cargo manifest parse failed: ${message}`);
  }
}

function dependencySpec(root, manifestPath, localName, value, workspaceDependencies) {
  let spec = value;
  let definitionRoot = dirname(manifestPath);
  if (typeof value === "object" && value !== null && value.workspace === true) {
    spec = workspaceDependencies[localName];
    definitionRoot = root;
    if (spec === undefined) {
      throw new Error(
        `${projectPath(root, manifestPath)}: workspace dependency ${localName} is not defined`,
      );
    }
  }

  if (typeof spec === "string") {
    return { packageName: localName, source: "registry", path: null };
  }
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw new Error(
      `${projectPath(root, manifestPath)}: dependency ${localName} has an invalid declaration`,
    );
  }

  const packageName = spec.package ?? localName;
  if (typeof packageName !== "string" || packageName.trim() === "") {
    throw new Error(
      `${projectPath(root, manifestPath)}: dependency ${localName} has an invalid package name`,
    );
  }
  const dependencyPath =
    typeof spec.path === "string" ? resolve(definitionRoot, spec.path) : null;
  const source =
    dependencyPath !== null ? "path" : typeof spec.git === "string" ? "git" : "registry";
  return { packageName, source, path: dependencyPath };
}

function appendDependencies(
  output,
  root,
  manifestPath,
  table,
  kind,
  target,
  workspaceDependencies,
) {
  if (table === undefined) return;
  if (typeof table !== "object" || table === null || Array.isArray(table)) {
    throw new Error(`${projectPath(root, manifestPath)}: invalid ${kind} dependency table`);
  }
  for (const [localName, value] of Object.entries(table)) {
    const spec = dependencySpec(root, manifestPath, localName, value, workspaceDependencies);
    output.push({
      localName,
      packageName: spec.packageName,
      kind,
      target,
      source: spec.source,
      path: spec.path,
    });
  }
}

function dependenciesForManifest(root, manifestPath, manifest, workspaceDependencies) {
  const dependencies = [];
  appendDependencies(
    dependencies,
    root,
    manifestPath,
    manifest.dependencies,
    "normal",
    null,
    workspaceDependencies,
  );
  appendDependencies(
    dependencies,
    root,
    manifestPath,
    manifest["dev-dependencies"],
    "dev",
    null,
    workspaceDependencies,
  );
  appendDependencies(
    dependencies,
    root,
    manifestPath,
    manifest["build-dependencies"],
    "build",
    null,
    workspaceDependencies,
  );

  for (const [target, targetTable] of Object.entries(manifest.target ?? {})) {
    appendDependencies(
      dependencies,
      root,
      manifestPath,
      targetTable.dependencies,
      "normal",
      target,
      workspaceDependencies,
    );
    appendDependencies(
      dependencies,
      root,
      manifestPath,
      targetTable["dev-dependencies"],
      "dev",
      target,
      workspaceDependencies,
    );
    appendDependencies(
      dependencies,
      root,
      manifestPath,
      targetTable["build-dependencies"],
      "build",
      target,
      workspaceDependencies,
    );
  }
  return dependencies;
}

function workspaceManifestPaths(root, workspace) {
  const members = workspace.members;
  if (!Array.isArray(members)) {
    throw new Error("Cargo.toml: workspace.members must be an explicit array");
  }
  const excluded = new Set(
    (workspace.exclude ?? []).flatMap((pattern) => globSync(pattern, { cwd: root })),
  );
  const paths = new Set();
  for (const pattern of members) {
    if (typeof pattern !== "string") {
      throw new Error("Cargo.toml: workspace member patterns must be strings");
    }
    const matches = globSync(pattern, { cwd: root });
    if (matches.length === 0) {
      throw new Error(`Cargo.toml: workspace member pattern has no matches: ${pattern}`);
    }
    for (const member of matches) {
      if (excluded.has(member)) continue;
      const manifestPath = member.endsWith("Cargo.toml")
        ? resolve(root, member)
        : resolve(root, member, "Cargo.toml");
      if (!existsSync(manifestPath)) {
        throw new Error(`Cargo.toml: workspace member has no Cargo.toml: ${member}`);
      }
      paths.add(manifestPath);
    }
  }
  return [...paths].sort();
}

export function loadWorkspacePackages(root) {
  const workspaceRoot = resolve(root);
  const rootManifestPath = join(workspaceRoot, "Cargo.toml");
  const rootManifest = parseManifest(workspaceRoot, rootManifestPath);
  if (typeof rootManifest.workspace !== "object" || rootManifest.workspace === null) {
    throw new Error("Cargo.toml: missing workspace table");
  }
  const workspaceDependencies = rootManifest.workspace.dependencies ?? {};
  const manifestPaths = workspaceManifestPaths(workspaceRoot, rootManifest.workspace);
  if (rootManifest.package !== undefined) manifestPaths.unshift(rootManifestPath);

  return manifestPaths.map((manifestPath) => {
    const manifest = manifestPath === rootManifestPath
      ? rootManifest
      : parseManifest(workspaceRoot, manifestPath);
    const packageName = manifest.package?.name;
    if (typeof packageName !== "string" || packageName.trim() === "") {
      throw new Error(`${projectPath(workspaceRoot, manifestPath)}: missing package.name`);
    }
    return {
      packageName,
      manifestPath: projectPath(workspaceRoot, manifestPath),
      dependencies: dependenciesForManifest(
        workspaceRoot,
        manifestPath,
        manifest,
        workspaceDependencies,
      ),
    };
  });
}

export function dependencyLabel(dependency) {
  return dependency.localName === dependency.packageName
    ? dependency.packageName
    : `${dependency.localName} (package ${dependency.packageName})`;
}
