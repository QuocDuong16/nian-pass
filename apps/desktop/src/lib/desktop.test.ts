import { afterEach, expect, test, vi } from "vitest";

import contract from "../../contracts/desktop-contract.json";
import { DesktopCommandError, desktopApi } from "./desktop";
import {
  parseDesktopErrorCode,
  parseSelectedVault,
  parseSummaryText,
  parseVaultSnapshot,
} from "./validation";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  invoke.mockReset();
});

test("committed Rust contract fixture passes runtime validation", () => {
  expect(parseSelectedVault(contract.selectedVault)).toEqual(
    contract.selectedVault,
  );
  expect(parseVaultSnapshot(contract.snapshot)).toEqual(contract.snapshot);
  expect(contract.errorCodes.map(parseDesktopErrorCode)).toEqual(
    contract.errorCodes,
  );
});

test("desktop adapter validates successful IPC responses", async () => {
  invoke
    .mockResolvedValueOnce(contract.selectedVault)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(null);

  await expect(desktopApi.selectVault()).resolves.toEqual(
    contract.selectedVault,
  );
  await expect(desktopApi.unlockVault("test-password")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.getVaultSnapshot()).resolves.toEqual(
    contract.snapshot,
  );
  await expect(desktopApi.lockVault()).resolves.toBeUndefined();
  expect(invoke).toHaveBeenNthCalledWith(2, "unlock_vault", {
    password: "test-password",
  });
});

test("missing rootGroupId becomes a generic internal failure", async () => {
  const malformed = structuredClone(contract.snapshot) as Record<
    string,
    unknown
  >;
  Reflect.deleteProperty(malformed, "rootGroupId");
  invoke.mockResolvedValue(malformed);

  await expect(desktopApi.getVaultSnapshot()).rejects.toMatchObject({
    code: "internal",
  });
});

test("unknown summary kind and wrong field type fail closed", () => {
  expect(() =>
    parseSummaryText({ kind: "future-secret-kind", value: "test-password" }),
  ).toThrow(/invalid desktop contract/);
  expect(() =>
    parseVaultSnapshot({ ...contract.snapshot, rootGroupId: 123 }),
  ).toThrow(/invalid desktop contract/);
});

test("unknown error codes become internal while known codes remain stable", async () => {
  invoke.mockRejectedValueOnce({
    code: "future_error",
    detail: "sensitive parser detail",
  });
  await expect(desktopApi.selectVault()).rejects.toEqual(
    new DesktopCommandError("internal"),
  );

  invoke.mockRejectedValueOnce({ code: "unlock_failed" });
  await expect(desktopApi.selectVault()).rejects.toEqual(
    new DesktopCommandError("unlock_failed"),
  );
});

test("snapshot relation mismatches fail closed", () => {
  const missingRoot = structuredClone(contract.snapshot);
  missingRoot.groups = [];
  expect(() => parseVaultSnapshot(missingRoot)).toThrow(
    /invalid desktop contract/,
  );

  const wrongGroup = structuredClone(contract.snapshot);
  const entry = wrongGroup.entries[0];
  if (entry === undefined) throw new Error("contract fixture entry is missing");
  entry.groupId = "group-other";
  expect(() => parseVaultSnapshot(wrongGroup)).toThrow(
    /invalid desktop contract/,
  );
});
