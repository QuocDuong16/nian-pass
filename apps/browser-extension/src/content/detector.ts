export interface DetectionResult {
  hasLoginForm: boolean;
  passwordFieldCount: number;
  usernameCandidateCount: number;
  formCount: number;
}

export interface FillTargetInputs {
  username: HTMLInputElement | null;
  password: HTMLInputElement;
}

function isExplicitlyHidden(input: HTMLInputElement): boolean {
  if (input.type === "hidden" || input.hidden) return true;
  for (
    let node: HTMLElement | null = input;
    node !== null;
    node = node.parentElement
  ) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return true;
  }
  const style = input.ownerDocument.defaultView?.getComputedStyle(input);
  return style?.display === "none" || style?.visibility === "hidden";
}

export function isEditableInput(input: HTMLInputElement): boolean {
  return (
    input.isConnected &&
    !input.disabled &&
    !input.readOnly &&
    !isExplicitlyHidden(input)
  );
}

export function isUsernameInput(input: HTMLInputElement): boolean {
  if (!isEditableInput(input) || !["text", "email", "tel"].includes(input.type))
    return false;
  return true;
}

export function detectLoginForms(document: Document): DetectionResult {
  const inputs = [...document.querySelectorAll("input")];
  const passwords = inputs.filter(
    (input): input is HTMLInputElement =>
      input instanceof HTMLInputElement &&
      input.type === "password" &&
      isEditableInput(input),
  );
  const forms = new Set(
    passwords.map((input) => input.form).filter((form) => form !== null),
  );
  const usernames = new Set<HTMLInputElement>();
  for (const password of passwords) {
    const scope: ParentNode = password.form ?? document;
    for (const input of scope.querySelectorAll("input")) {
      if (input instanceof HTMLInputElement && isUsernameInput(input))
        usernames.add(input);
    }
  }
  return {
    hasLoginForm: passwords.length > 0,
    passwordFieldCount: passwords.length,
    usernameCandidateCount: usernames.size,
    formCount: forms.size,
  };
}

export function detectFillTarget(document: Document): FillTargetInputs | null {
  const inputs = [...document.querySelectorAll("input")].filter(
    (input): input is HTMLInputElement => input instanceof HTMLInputElement,
  );
  const passwords = inputs.filter(
    (input) => input.type === "password" && isEditableInput(input),
  );
  const password = passwords[0];
  if (passwords.length !== 1 || password === undefined) return null;
  const scope: ParentNode = password.form ?? document;
  const usernames = [...scope.querySelectorAll("input")].filter(
    (input): input is HTMLInputElement =>
      input instanceof HTMLInputElement && isUsernameInput(input),
  );
  if (usernames.length > 1) return null;
  return { username: usernames[0] ?? null, password };
}

export function detectionSignature(result: DetectionResult): string {
  return [
    result.passwordFieldCount,
    result.usernameCandidateCount,
    result.formCount,
  ].join(":");
}
