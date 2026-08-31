import { spawnSync } from "node:child_process";

const requested = process.argv[2];
const targets = requested === "all" ? ["chromium", "firefox"] : [requested];

if (!targets.every((target) => target === "chromium" || target === "firefox")) {
  process.stderr.write("Usage: node build/build.mjs chromium|firefox|all\n");
  process.exit(2);
}

for (const target of targets) {
  for (const entry of ["background", "content", "popup"]) {
    const result = spawnSync(
      "pnpm",
      ["exec", "vite", "build", "--mode", `${target}-${entry}`],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
