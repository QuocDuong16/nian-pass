import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { pinnedRustVersion } from "../release_toolchain.mjs";
import {
  parseDumpbinStackReserve,
  parseLlvmStackReserve,
} from "../pe_stack_reserve.mjs";

test("PE stack reserve parsers keep dumpbin hexadecimal distinct from LLVM formats", () => {
  assert.equal(parseDumpbinStackReserve("100000"), 1048576n);
  assert.equal(parseDumpbinStackReserve("800000"), 8388608n);
  assert.equal(parseLlvmStackReserve("0x800000"), 8388608n);
  assert.equal(parseLlvmStackReserve("8388608"), 8388608n);
});

test("PE stack reserve helper CLI decodes accepted tool-specific formats", () => {
  const helperPath = resolve(import.meta.dirname, "../pe_stack_reserve.mjs");
  for (const [source, value, expected] of [
    ["dumpbin", "100000", "1048576\n"],
    ["dumpbin", "800000", "8388608\n"],
    ["llvm-readobj", "0x800000", "8388608\n"],
    ["llvm-readobj", "8388608", "8388608\n"],
  ]) {
    const result = spawnSync(process.execPath, [helperPath, source, value], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  }
});

test("PE stack reserve helper CLI fails closed on invalid input", () => {
  const helperPath = resolve(import.meta.dirname, "../pe_stack_reserve.mjs");
  for (const arguments_ of [
    ["unknown", "800000"],
    ["dumpbin"],
    ["dumpbin", "0x800000"],
    ["llvm-readobj", "eight-megabytes"],
  ]) {
    const result = spawnSync(process.execPath, [helperPath, ...arguments_], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /PE stack reserve|SizeOfStackReserve|invalid/i);
    assert.ok(result.stderr.length < 256);
  }
});

test("Windows release Rust pin parser accepts LF, CRLF, and trailing horizontal whitespace", () => {
  for (const mise of [
    '[tools]\nrust = "1.98.0"\n',
    '[tools]\r\nrust = "1.98.0"\r\n',
    '[tools]\r\nrust = "1.98.0"   \r\n',
  ]) {
    assert.equal(pinnedRustVersion(mise), "1.98.0");
  }
});

test("Windows release Rust pin parser fails closed on malformed configuration", () => {
  for (const mise of [
    "[tools]\nnode = \"26.7.0\"\n",
    '[tools]\nrust = ""\n',
    '[tools]\nrust = "1.98.0\n',
  ]) {
    assert.throws(() => pinnedRustVersion(mise), /Could not read the pinned Rust version/);
  }
});

test("Windows release script invokes the tested TOML toolchain helper", (t) => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const script = readFileSync(join(repositoryRoot, "scripts/release_windows.ps1"), "utf8");
  assert.match(
    script,
    /Get-CheckedOutput "node" @\("scripts\/release_toolchain\.mjs", "\.mise\.toml"\)/,
  );
  const pnpmInstall = script.indexOf('Invoke-Checked "pnpm" @("install", "--frozen-lockfile")');
  assert.ok(pnpmInstall >= 0);
  assert.ok(script.indexOf('Assert-PrivateNodeToolCommand "pnpm"') < pnpmInstall);
  assert.ok(script.indexOf('Get-CheckedOutput $pnpmPath @("--version")') < pnpmInstall);
  assert.match(
    script,
    /Get-Command \$Name -CommandType Application -All -ErrorAction Stop/,
  );
  assert.match(script, /\$selected\s*=\s*\$commands\[0\]/);
  assert.match(script, /\$source\s*=\s*\[string\] \$selected\.Path/);
  assert.doesNotMatch(
    script,
    /\(Get-Command \$Name -CommandType Application[^)]*\)\.Source/,
  );

  const root = mkdtempSync(join(tmpdir(), "nian-pass-release-toolchain-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const misePath = join(root, ".mise.toml");
  writeFileSync(misePath, '[tools]\r\nrust = "1.98.0"\r\n');
  const result = spawnSync(process.execPath, [
    join(repositoryRoot, "scripts/release_toolchain.mjs"),
    misePath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "1.98.0\n");
});

test("Windows release script emits bounded diagnostics before post-build rejection", () => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const script = readFileSync(join(repositoryRoot, "scripts/release_windows.ps1"), "utf8");
  assert.match(script, /function Show-PostBuildSourceDiagnostics/);
  assert.match(script, /git status --porcelain=v1 --untracked-files=all/);
  assert.match(script, /git diff --name-status/);
  assert.match(script, /git diff --numstat/);
  assert.match(script, /git ls-files --eol apps\/desktop\/src-tauri\/Cargo\.toml/);
  assert.match(script, /git diff -- apps\/desktop\/src-tauri\/Cargo\.toml/);
  assert.match(
    script,
    /Show-PostBuildSourceDiagnostics\s*\r?\nInvoke-Checked "node" @\("scripts\/check_release_source\.mjs", "--postbuild"\)/,
  );
});

test("Windows release source verifies the desktop PE reserve and graceful shutdown", () => {
  const repositoryRoot = resolve(import.meta.dirname, "../..");
  const buildScript = readFileSync(
    join(repositoryRoot, "apps/desktop/src-tauri/build.rs"),
    "utf8",
  );
  const desktopMain = readFileSync(
    join(repositoryRoot, "apps/desktop/src-tauri/src/main.rs"),
    "utf8",
  );
  const script = readFileSync(join(repositoryRoot, "scripts/release_windows.ps1"), "utf8");

  assert.match(buildScript, /CARGO_CFG_TARGET_OS/);
  assert.match(buildScript, /CARGO_CFG_TARGET_ENV/);
  assert.match(buildScript, /cargo:rustc-link-arg-bin=nian-pass-desktop=\/STACK:8388608/);
  assert.doesNotMatch(buildScript, /RUST_MIN_STACK/);
  assert.match(buildScript, /tauri_build::build\(\)/);
  assert.match(desktopMain, /not\(debug_assertions\), target_os = "windows"/);
  assert.match(desktopMain, /windows_subsystem = "windows"/);

  assert.match(script, /Resolve-Path "target\/x86_64-pc-windows-msvc\/release\/nian-pass-desktop\.exe"/);
  assert.match(script, /dumpbin/);
  assert.match(script, /llvm-readobj/);
  assert.match(script, /Convert-PeStackReserve "dumpbin"/);
  assert.match(script, /Convert-PeStackReserve "llvm-readobj"/);
  assert.doesNotMatch(script, /function Convert-PeInteger/);
  assert.match(script, /SizeOfStackReserve/);
  assert.match(script, /\[UInt64\]8388608/);
  assert.match(script, /Start-Process -FilePath \$Binary -PassThru/);
  assert.match(script, /Start-Sleep -Seconds 8/);
  assert.match(script, /Start-DesktopAndRequireStartup/);
  assert.match(script, /Test-DesktopGracefulShutdown/);
  assert.match(script, /CloseMainWindow\(\)/);
  assert.match(script, /WaitForExit\(5000\)/);
  assert.match(script, /\$Process\.ExitCode -ne 0/);
  assert.match(script, /Stop-DesktopAfterFailedShutdown[\s\S]*?Stop-Process[\s\S]*?throw "Windows desktop graceful shutdown/);
  assert.match(script, /STATUS_STACK_OVERFLOW \(0xC00000FD\)/);
  assert.match(script, /decimal \$ExitCode \(0x\$\(\$raw\.ToString\('X8'\)\)\)/);
  assert.match(script, /native_messaging_host_smoke/);
  assert.match(script, /desktop_shutdown_smoke/);
  assert.doesNotMatch(script, /Set-ReleaseOutput "process_smoke"/);

  const workflow = readFileSync(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
  assert.match(workflow, /desktop_startup_smoke: \$\{\{ steps\.build\.outputs\.desktop_startup_smoke \}\}/);
  assert.match(workflow, /desktop_shutdown_smoke: \$\{\{ steps\.build\.outputs\.desktop_shutdown_smoke \}\}/);
  assert.match(workflow, /native_messaging_host_smoke: \$\{\{ steps\.build\.outputs\.native_messaging_host_smoke \}\}/);
  assert.match(workflow, /WINDOWS_DESKTOP_SHUTDOWN_STATUS/);
  assert.match(workflow, /WINDOWS_GUI_STATUS: NOT RUN/);

  const helper = readFileSync(join(repositoryRoot, "scripts/pe_stack_reserve.mjs"), "utf8");
  assert.match(helper, /import \{ pathToFileURL \} from "node:url"/);
  assert.match(helper, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  assert.doesNotMatch(helper, /new URL\(import\.meta\.url\)\.pathname/);
});
