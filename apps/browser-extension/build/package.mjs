import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
mkdirSync(resolve(root, "dist"), { recursive: true });
for (const target of ["chromium", "firefox"]) {
  const result = spawnSync("zip", ["-qr", `../${target}.zip`, "."], {
    cwd: resolve(root, "dist", target),
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
