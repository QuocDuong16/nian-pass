function requireValue(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("PE stack reserve value is required");
  }
  return value;
}

export function parseDumpbinStackReserve(value) {
  const encoded = requireValue(value);
  if (!/^[0-9a-fA-F]+$/.test(encoded)) {
    throw new Error(`invalid dumpbin SizeOfStackReserve ${encoded}`);
  }
  return BigInt(`0x${encoded}`);
}

export function parseLlvmStackReserve(value) {
  const encoded = requireValue(value);
  if (/^0x[0-9a-fA-F]+$/.test(encoded)) return BigInt(encoded);
  if (/^[0-9]+$/.test(encoded)) return BigInt(encoded);
  throw new Error(`invalid llvm SizeOfStackReserve ${encoded}`);
}

function main() {
  const [source, value] = process.argv.slice(2);
  const reserve = source === "dumpbin"
    ? parseDumpbinStackReserve(value)
    : source === "llvm-readobj"
      ? parseLlvmStackReserve(value)
      : (() => { throw new Error("PE stack reserve source must be dumpbin or llvm-readobj"); })();
  process.stdout.write(`${reserve}\n`);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
import { pathToFileURL } from "node:url";
