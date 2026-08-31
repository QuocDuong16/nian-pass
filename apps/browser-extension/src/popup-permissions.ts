import type Browser from "webextension-polyfill";

export interface PopupPermissionApi {
  requestOrigin(pattern: string): Promise<boolean>;
  removeOrigin(pattern: string): Promise<boolean>;
}

export function createPopupPermissionApi(
  webExtension: typeof Browser,
): PopupPermissionApi {
  return {
    requestOrigin(pattern) {
      return webExtension.permissions.request({ origins: [pattern] });
    },
    removeOrigin(pattern) {
      return webExtension.permissions.remove({ origins: [pattern] });
    },
  };
}
