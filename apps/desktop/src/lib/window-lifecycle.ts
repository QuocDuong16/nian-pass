import { getCurrentWindow } from "@tauri-apps/api/window";

export interface CloseRequestEvent {
  preventDefault: () => void;
}

export interface DesktopWindowLifecycle {
  onCloseRequested: (
    handler: (event: CloseRequestEvent) => Promise<void>,
  ) => Promise<() => void>;
  onFocusChanged?: (handler: (focused: boolean) => void) => Promise<() => void>;
  isFocused?: () => Promise<boolean>;
  requestClose: () => Promise<void>;
}

export const desktopWindowLifecycle: DesktopWindowLifecycle = {
  onCloseRequested: (handler) => getCurrentWindow().onCloseRequested(handler),
  onFocusChanged: (handler) =>
    getCurrentWindow().onFocusChanged(({ payload }) => {
      handler(payload);
    }),
  isFocused: () => getCurrentWindow().isFocused(),
  requestClose: () => getCurrentWindow().close(),
};
