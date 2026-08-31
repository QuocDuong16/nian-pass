import { PROTOCOL_VERSION, type ApplyCredential } from "../protocol";
import { FieldRegistry } from "./field-registry";

function fixture(): {
  form: HTMLFormElement;
  username: HTMLInputElement;
  password: HTMLInputElement;
} {
  document.body.textContent = "";
  const form = document.createElement("form");
  const username = document.createElement("input");
  username.type = "email";
  const password = document.createElement("input");
  password.type = "password";
  const submit = document.createElement("button");
  submit.type = "submit";
  form.append(username, password, submit);
  document.body.append(form);
  return { form, username, password };
}

function command(
  registry: FieldRegistry,
  username: HTMLInputElement,
  password: HTMLInputElement,
): ApplyCredential {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "applyCredential",
    documentNonce: registry.documentNonce,
    usernameFieldHandle: registry.handleFor(username),
    passwordFieldHandle: registry.handleFor(password),
    username: "synthetic-user@example.test",
    password: "synthetic-password",
  };
}

describe("credential application primitive", () => {
  test("applies exact fields, dispatches events, and never submits", () => {
    const { form, username, password } = fixture();
    const registry = new FieldRegistry(document, "a".repeat(32));
    const inputEvents: string[] = [];
    const changeEvents: string[] = [];
    let submits = 0;
    form.addEventListener("input", (event) =>
      inputEvents.push((event.target as HTMLInputElement).type),
    );
    form.addEventListener("change", (event) =>
      changeEvents.push((event.target as HTMLInputElement).type),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submits += 1;
    });
    expect(registry.apply(command(registry, username, password))).toBe(
      "applied",
    );
    expect(username.value).toBe("synthetic-user@example.test");
    expect(password.value).toBe("synthetic-password");
    expect(inputEvents).toEqual(["email", "password"]);
    expect(changeEvents).toEqual(["email", "password"]);
    expect(submits).toBe(0);
  });

  test("rejects stale documents, unknown handles, and disconnected fields", () => {
    const { username, password } = fixture();
    const registry = new FieldRegistry(document, "b".repeat(32));
    const valid = command(registry, username, password);
    expect(registry.apply({ ...valid, documentNonce: "c".repeat(32) })).toBe(
      "staleDocument",
    );
    expect(registry.apply({ ...valid, passwordFieldHandle: "unknown" })).toBe(
      "unknownField",
    );
    password.remove();
    expect(registry.apply(valid)).toBe("invalidField");
    expect(username.value).toBe("");
  });

  test.each(["disabled", "readOnly"] as const)(
    "rejects %s targets",
    (property) => {
      const { username, password } = fixture();
      const registry = new FieldRegistry(document, "d".repeat(32));
      password[property] = true;
      expect(registry.apply(command(registry, username, password))).toBe(
        "invalidField",
      );
    },
  );

  test("enforces password and username target types", () => {
    const { username, password } = fixture();
    const registry = new FieldRegistry(document, "e".repeat(32));
    const valid = command(registry, username, password);
    password.type = "text";
    expect(registry.apply(valid)).toBe("invalidField");
    password.type = "password";
    username.type = "number";
    expect(registry.apply(valid)).toBe("invalidField");
  });

  test("old handles cannot mutate a replacement document authority", () => {
    const { username, password } = fixture();
    const documentA = new FieldRegistry(document, "f".repeat(32));
    const oldCommand = command(documentA, username, password);
    const documentB = new FieldRegistry(document, "0".repeat(32));
    expect(documentB.apply(oldCommand)).toBe("staleDocument");
    expect(username.value).toBe("");
    expect(password.value).toBe("");
  });
});
