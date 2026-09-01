import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface BrowserApprovalApi {
  subscribe: (handler: (requestId: string) => void) => Promise<() => void>;
  resolve: (requestId: string, allow: boolean) => Promise<void>;
}

function parseRequestId(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    !("requestId" in payload)
  ) {
    return null;
  }
  const requestId = Reflect.get(payload, "requestId");
  return typeof requestId === "string" && /^[0-9a-f]{32}$/.test(requestId)
    ? requestId
    : null;
}

export const browserApprovalApi: BrowserApprovalApi = {
  async subscribe(handler) {
    return listen<unknown>("browser-connection-request", (event) => {
      const requestId = parseRequestId(event.payload);
      if (requestId !== null) handler(requestId);
    });
  },
  async resolve(requestId, allow) {
    if (!/^[0-9a-f]{32}$/.test(requestId)) {
      throw new Error("Invalid browser approval request");
    }
    await invoke("resolve_browser_connection", { requestId, allow });
  },
};
