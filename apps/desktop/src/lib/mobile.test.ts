import { afterEach, expect, test, vi } from "vitest";

import contract from "../../contracts/mobile-contract.json";
import { MobileCommandError, mobileApi, parseMobileErrorCode } from "./mobile";
import { parseEntryDetail } from "./entry-validation";
import { parseSelectedVault, parseVaultSnapshot } from "./validation";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  invoke.mockReset();
});

test("committed mobile contract passes exact runtime validation", () => {
  expect(parseSelectedVault(contract.selectedVault)).toEqual(
    contract.selectedVault,
  );
  expect(parseVaultSnapshot(contract.snapshot)).toEqual(contract.snapshot);
  expect(parseEntryDetail(contract.entryDetail)).toEqual(contract.entryDetail);
  expect(contract.errors.map(parseMobileErrorCode)).toEqual(contract.errors);
});

test("mobile adapter invokes only semantic read-only commands", async () => {
  invoke
    .mockResolvedValueOnce(contract.selectedVault)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.snapshot)
    .mockResolvedValueOnce(contract.entryDetail)
    .mockResolvedValueOnce(null);

  await expect(mobileApi.selectVault()).resolves.toEqual(
    contract.selectedVault,
  );
  await expect(mobileApi.unlockVault("attempt-only")).resolves.toEqual(
    contract.snapshot,
  );
  await expect(mobileApi.getVaultSnapshot()).resolves.toEqual(
    contract.snapshot,
  );
  await expect(mobileApi.getEntryDetail("entry-example")).resolves.toEqual(
    contract.entryDetail,
  );
  await expect(mobileApi.lockVault()).resolves.toBeUndefined();

  expect(invoke).toHaveBeenNthCalledWith(1, "mobile_select_vault", undefined);
  expect(invoke).toHaveBeenNthCalledWith(2, "mobile_unlock_vault", {
    password: "attempt-only",
  });
  expect(invoke).toHaveBeenNthCalledWith(3, "mobile_vault_snapshot", undefined);
  expect(invoke).toHaveBeenNthCalledWith(4, "mobile_entry_detail", {
    entryId: "entry-example",
  });
  expect(invoke).toHaveBeenNthCalledWith(5, "mobile_lock_vault", undefined);
});

test("native failures and unknown errors cannot leak details", async () => {
  invoke.mockRejectedValueOnce({
    code: "future_error",
    message: "content://com.example.secret.provider/document/private%3Avault",
  });
  await expect(mobileApi.selectVault()).rejects.toEqual(
    new MobileCommandError("internal"),
  );

  invoke.mockRejectedValueOnce({
    code: "picker_failed",
    message: "/data/user/0/dev.nian.pass/no_backup/private.kdbx",
  });
  await expect(mobileApi.selectVault()).rejects.toEqual(
    new MobileCommandError("picker_failed"),
  );
});

test("mobile DTO validation rejects extra transport and secret keys", async () => {
  invoke.mockResolvedValueOnce({
    ...contract.selectedVault,
    contentUri: "content://provider/document/id",
  });
  await expect(mobileApi.selectVault()).rejects.toEqual(
    new MobileCommandError("internal"),
  );

  invoke.mockResolvedValueOnce({ ...contract.entryDetail, notes: "secret" });
  await expect(mobileApi.getEntryDetail("entry-example")).rejects.toEqual(
    new MobileCommandError("internal"),
  );
});
