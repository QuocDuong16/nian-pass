import type { DesktopApi } from "./desktop-api-types";
import { parseCleanVaultSnapshot, parseSelectedKeyfile } from "./validation";

type DesktopCall = <T>(
  command: string,
  parse: (value: unknown) => T,
  args?: Record<string, unknown>,
) => Promise<T>;

type CredentialApi = Pick<
  DesktopApi,
  | "changeMasterPassword"
  | "clearKeyfile"
  | "credentialHasKeyfile"
  | "credentialHasPassword"
  | "removeKeyfile"
  | "replaceKeyfile"
  | "removeMasterPassword"
  | "selectKeyfile"
>;

function parseVoid(value: unknown): void {
  if (value !== null) throw new Error("invalid desktop void response");
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("invalid desktop boolean response");
  }
  return value;
}

export function createCredentialApi(call: DesktopCall): CredentialApi {
  return {
    selectKeyfile: () =>
      call("select_keyfile", (value) =>
        value === null ? null : parseSelectedKeyfile(value),
      ),
    clearKeyfile: () => call("clear_keyfile", parseVoid),
    credentialHasKeyfile: () => call("credential_has_keyfile", parseBoolean),
    credentialHasPassword: () => call("credential_has_password", parseBoolean),
    replaceKeyfile: () =>
      call("replace_keyfile", (value) =>
        value === null ? null : parseSelectedKeyfile(value),
      ),
    removeKeyfile: () => call("remove_keyfile", parseVoid),
    changeMasterPassword: (newPassword) =>
      call("change_master_password", parseCleanVaultSnapshot, { newPassword }),
    removeMasterPassword: () =>
      call("remove_master_password", parseCleanVaultSnapshot),
  };
}
