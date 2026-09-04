import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 5_000;
const ATTEMPT_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function isAuditReport(output) {
  try {
    const report = JSON.parse(output);
    return (
      report !== null &&
      typeof report === "object" &&
      ("advisories" in report ||
        "vulnerabilities" in report ||
        "metadata" in report ||
        "auditReportVersion" in report)
    );
  } catch {
    return false;
  }
}

export function isRetryableRegistryFailure(result) {
  if (result.status === 0 || isAuditReport(result.stdout ?? "")) return false;
  const diagnostic =
    `${result.error?.code ?? ""}\n${result.error?.message ?? ""}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`.toLowerCase();
  return [
    "advisories/bulk",
    "eai_again",
    "econnrefused",
    "econnreset",
    "enotfound",
    "err_pnpm_audit_bad_response",
    "err_pnpm_meta_fetch_fail",
    "etimedout",
    "fetch failed",
    "getaddrinfo",
    "operation was aborted",
    "registry responded with an error",
    "socket hang up",
    "timeout",
  ].some((marker) => diagnostic.includes(marker));
}

function runPnpmAudit() {
  return spawnSync("pnpm", ["audit", "--prod", "--json"], {
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: ATTEMPT_TIMEOUT_MS,
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function emitFinalResult(result, output, errorOutput) {
  if (result.stdout) output.write(result.stdout);
  if (result.stderr) errorOutput.write(result.stderr);
  if (result.error)
    errorOutput.write(`Unable to run pnpm audit: ${result.error.message}\n`);
}

export async function runAudit({
  audit = runPnpmAudit,
  wait = delay,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = audit();
    if (result.status === 0) {
      emitFinalResult(result, output, errorOutput);
      return 0;
    }
    if (!isRetryableRegistryFailure(result) || attempt === MAX_ATTEMPTS) {
      emitFinalResult(result, output, errorOutput);
      return Number.isInteger(result.status) ? result.status : 1;
    }
    errorOutput.write(
      `pnpm audit registry request failed transiently; retrying once in ${RETRY_DELAY_MS / 1_000} seconds.\n`,
    );
    await wait(RETRY_DELAY_MS);
  }
  return 1;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = await runAudit();
