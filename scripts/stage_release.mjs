import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "artifacts/release");
const accepted = /\.(?:AppImage|apk|deb|msi|rpm|exe)$/i;

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

mkdirSync(output, { recursive: true });
const roots = [
  resolve(root, "target/release/bundle"),
  resolve(root, "target/x86_64-pc-windows-msvc/release/bundle"),
  resolve(root, "apps/desktop/src-tauri/target/release/bundle"),
  resolve(root, "apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle"),
  resolve(root, "apps/desktop/src-tauri/gen/android/app/build/outputs/apk"),
];
let count = 0;
for (const path of roots.flatMap(walk).filter((item) => accepted.test(item))) {
  copyFileSync(path, resolve(output, basename(path)));
  count += 1;
}
if (count === 0) {
  process.stderr.write("No desktop or Android release artifacts were found to stage.\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`Staged ${count} desktop/Android release artifact(s).\n`);
}
