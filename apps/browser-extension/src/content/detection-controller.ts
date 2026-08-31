import {
  detectLoginForms,
  detectionSignature,
  type DetectionResult,
} from "./detector";
import { PROTOCOL_VERSION, type PageStateChanged } from "../protocol";

export type DetectionReporter = (
  message: PageStateChanged,
) => void | Promise<void>;

export class DetectionController {
  readonly #observer: MutationObserver;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastSignature: string | undefined;

  constructor(
    private readonly document: Document,
    private readonly documentNonce: string,
    private readonly report: DetectionReporter,
    private readonly debounceMilliseconds = 40,
  ) {
    const view = document.defaultView;
    if (view === null) throw new Error("Document has no browsing context");
    this.#observer = new view.MutationObserver(() => {
      this.schedule();
    });
  }

  start(): void {
    const root = this.document.documentElement;
    this.#observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "type",
        "disabled",
        "readonly",
        "hidden",
        "autocomplete",
        "form",
        "aria-hidden",
      ],
    });
    this.schedule();
  }

  stop(): void {
    this.#observer.disconnect();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  schedule(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#detectAndReport();
    }, this.debounceMilliseconds);
  }

  #detectAndReport(): void {
    const result = detectLoginForms(this.document);
    const signature = detectionSignature(result);
    if (signature === this.#lastSignature) return;
    this.#lastSignature = signature;
    const message = this.#message(result);
    void Promise.resolve(this.report(message)).catch(() => undefined);
  }

  #message(result: DetectionResult): PageStateChanged {
    return {
      protocolVersion: PROTOCOL_VERSION,
      type: "pageStateChanged",
      documentNonce: this.documentNonce,
      ...result,
    };
  }
}
