import type { ApplyCredential } from "../protocol";
import { isEditableInput, isUsernameInput } from "./detector";

export type FillResult =
  "applied" | "staleDocument" | "unknownField" | "invalidField";

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const view = input.ownerDocument.defaultView;
  const prototype = view?.HTMLInputElement.prototype;
  const setter = (
    prototype === undefined
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, "value")?.set
  ) as ((this: HTMLInputElement, value: string) => void) | undefined;
  if (setter === undefined) throw new Error("Native input setter unavailable");
  Reflect.apply(setter, input, [value]);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function createDocumentNonce(): string {
  return randomToken();
}

export class FieldRegistry {
  readonly #handles = new WeakMap<HTMLInputElement, string>();
  readonly #fields = new Map<string, WeakRef<HTMLInputElement>>();

  constructor(
    private readonly document: Document,
    readonly documentNonce = createDocumentNonce(),
  ) {}

  handleFor(input: HTMLInputElement): string {
    const existing = this.#handles.get(input);
    if (existing !== undefined) return existing;
    const handle = randomToken();
    this.#handles.set(input, handle);
    this.#fields.set(handle, new WeakRef(input));
    return handle;
  }

  apply(command: ApplyCredential): FillResult {
    if (command.documentNonce !== this.documentNonce) return "staleDocument";
    const password = this.#resolve(command.passwordFieldHandle);
    if (password === undefined) return "unknownField";
    let username: HTMLInputElement | null = null;
    if (command.usernameFieldHandle !== null) {
      const resolved = this.#resolve(command.usernameFieldHandle);
      if (resolved === undefined) return "unknownField";
      username = resolved;
    }
    if (password.type !== "password" || !this.#isCurrentEditable(password)) {
      return "invalidField";
    }
    if (
      username !== null &&
      (!this.#isCurrentEditable(username) || !isUsernameInput(username))
    ) {
      return "invalidField";
    }
    if (username !== null) setNativeValue(username, command.username);
    setNativeValue(password, command.password);
    return "applied";
  }

  #resolve(handle: string): HTMLInputElement | undefined {
    return this.#fields.get(handle)?.deref();
  }

  #isCurrentEditable(input: HTMLInputElement): boolean {
    return input.ownerDocument === this.document && isEditableInput(input);
  }
}
