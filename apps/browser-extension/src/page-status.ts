import type { PageStateChanged } from "./protocol";

interface StoredPageState {
  documentNonce: string;
  origin: string;
  detected: boolean;
}

export class PageStatusStore {
  readonly #states = new Map<number, StoredPageState>();

  update(tabId: number, origin: string, state: PageStateChanged): void {
    this.#states.set(tabId, {
      documentNonce: state.documentNonce,
      origin,
      detected: state.hasLoginForm,
    });
  }

  detection(
    tabId: number,
    origin: string,
  ): "detected" | "notDetected" | "waiting" {
    const state = this.#states.get(tabId);
    if (state?.origin !== origin) return "waiting";
    return state.detected ? "detected" : "notDetected";
  }

  clearTab(tabId: number): void {
    this.#states.delete(tabId);
  }

  clearOrigin(origin: string): void {
    for (const [tabId, state] of this.#states) {
      if (state.origin === origin) this.#states.delete(tabId);
    }
  }

  clearAll(): void {
    this.#states.clear();
  }
}
