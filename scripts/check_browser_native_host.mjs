import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function requirePattern(violations, name, source, pattern, message) {
  if (!pattern.test(source)) violations.push(`${name}: ${message}`);
}

function rejectPattern(violations, name, source, pattern, message) {
  if (pattern.test(source)) violations.push(`${name}: ${message}`);
}

export function runNativeHostChecks(root) {
  const violations = [];
  const hostRoot = resolve(root, "apps/browser-native-host");
  const protocolRoot = resolve(root, "crates/browser-native-protocol");
  const hostManifest = readFileSync(resolve(hostRoot, "Cargo.toml"), "utf8");
  const protocolManifest = readFileSync(
    resolve(protocolRoot, "Cargo.toml"),
    "utf8",
  );
  const hostSources = walk(resolve(hostRoot, "src"))
    .filter((path) => path.endsWith(".rs"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const protocolSources = walk(resolve(protocolRoot, "src"))
    .filter((path) => path.endsWith(".rs"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  const manifests = `${hostManifest}\n${protocolManifest}`;
  const identityFiles = [
    ...walk(resolve(root, "browser")),
    ...walk(resolve(root, "apps/browser-extension/src")),
    ...walk(resolve(hostRoot, "src")),
    ...walk(resolve(protocolRoot, "src")),
  ];

  for (const path of identityFiles) {
    const name = relative(root, path).replaceAll("\\", "/");
    if (/\.pem$/i.test(name)) {
      violations.push(`${name}: private browser signing files are forbidden`);
    }
    const source = readFileSync(path, "utf8");
    rejectPattern(
      violations,
      name,
      source,
      /-----BEGIN (?:RSA )?PRIVATE KEY-----/,
      "private browser signing material is forbidden",
    );
  }

  rejectPattern(
    violations,
    "native host manifests",
    manifests,
    /(?:^|\n)\s*(?:kdbx|vault-session|vault_session|keepass)\s*=/m,
    "KDBX and vault-session dependencies are forbidden",
  );
  rejectPattern(
    violations,
    "native host manifests",
    manifests,
    /(?:^|\n)\s*(?:reqwest|hyper|ureq|axum|actix-web|tokio|tungstenite)\s*=/m,
    "network and async-web dependencies are forbidden",
  );
  rejectPattern(
    violations,
    "native host production",
    hostSources,
    /\b(?:TcpListener|TcpStream|UdpSocket|WebSocket|HttpServer)\b/,
    "network transports are forbidden",
  );
  rejectPattern(
    violations,
    "native host production",
    hostSources,
    /\b(?:print|println)!\s*\(/,
    "stdout diagnostics would corrupt Native Messaging framing",
  );
  requirePattern(
    violations,
    "browser-native-protocol",
    protocolSources,
    /MAX_FRAME_BYTES:\s*usize\s*=\s*256\s*\*\s*1024/,
    "the 256 KiB frame cap is required",
  );
  requirePattern(
    violations,
    "browser-native-protocol",
    protocolSources,
    /declared\s*>\s*MAX_FRAME_BYTES[\s\S]{0,160}FrameError::Oversized/,
    "declared frame length must be checked before allocation",
  );
  requirePattern(
    violations,
    "browser-native-protocol",
    protocolSources,
    /HOST_NAME:\s*&str\s*=\s*"io\.nianpass\.browser"/,
    "the exact native host name is required",
  );
  requirePattern(
    violations,
    "native host production",
    hostSources,
    /read_request\(&mut browser_input\)/,
    "native stdin must use strict framed requests",
  );
  requirePattern(
    violations,
    "native host production",
    hostSources,
    /write_message\(&mut browser_output/,
    "native stdout must use strict framed responses",
  );
  return violations;
}

function main() {
  const violations = runNativeHostChecks(repositoryRoot);
  if (violations.length === 0) {
    process.stdout.write("Browser native-host architecture checks passed.\n");
    return;
  }
  process.stderr.write(
    `Browser native-host check failed:\n${violations
      .map((item) => `- ${item}`)
      .join("\n")}\n`,
  );
  process.exitCode = 1;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
