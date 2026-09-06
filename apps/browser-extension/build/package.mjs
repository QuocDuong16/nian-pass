import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const extensionRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(extensionRoot, "../..");

function filesBelow(directory) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = resolve(directory, entry);
      return statSync(path).isDirectory() ? filesBelow(path) : [path];
    })
    .sort((left, right) => left.localeCompare(right));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function header(signature, size) {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32LE(signature, 0);
  return bytes;
}

export function deterministicZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll("\\", "/"));
    const body = Buffer.from(entry.bytes);
    const checksum = crc32(body);
    const local = header(0x04034b50, 30);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, body);

    const central = header(0x02014b50, 46);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const central = Buffer.concat(centralParts);
  const end = header(0x06054b50, 22);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

function main() {
  const version = readFileSync(
    resolve(repositoryRoot, "VERSION"),
    "utf8",
  ).trim();
  const outputRoot = resolve(repositoryRoot, "artifacts/release");
  mkdirSync(outputRoot, { recursive: true });
  for (const target of ["chromium", "firefox"]) {
    const directory = resolve(extensionRoot, "dist", target);
    const entries = filesBelow(directory).map((path) => ({
      name: relative(directory, path),
      bytes: readFileSync(path),
    }));
    const archive = deterministicZip(entries);
    const name = `nian-pass-browser-${target}-${version}.zip`;
    writeFileSync(resolve(outputRoot, name), archive);
    const digest = createHash("sha256").update(archive).digest("hex");
    process.stdout.write(`Packaged ${name} (${digest})\n`);
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
