import { getCurrentWindow } from "@tauri-apps/api/window";

export interface CloseRequestEvent {
  preventDefault: () => void;
}

export interface DesktopWindowLifecycle {
  onCloseRequested: (
    handler: (event: CloseRequestEvent) => Promise<void>,
  ) => Promise<() => void>;
  requestClose: () => Promise<void>;
}

export const desktopWindowLifecycle: DesktopWindowLifecycle = {
  onCloseRequested: (handler) => getCurrentWindow().onCloseRequested(handler),
  requestClose: () => getCurrentWindow().close(),
};
