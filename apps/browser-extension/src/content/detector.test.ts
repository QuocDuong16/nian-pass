import { detectLoginForms } from "./detector";

function setBody(markup: string): void {
  document.body.textContent = "";
  const template = document.createElement("template");
  template.innerHTML = markup;
  document.body.append(template.content);
}

describe("structural login detector", () => {
  test.each([
    [
      '<form><input autocomplete="username"><input type="password" autocomplete="current-password"></form>',
      1,
      1,
    ],
    ['<form><input type="text"><input type="password"></form>', 1, 1],
    ['<form><input type="email"><input type="password"></form>', 1, 1],
    ['<form><input type="password"></form>', 1, 0],
    [
      '<form><input autocomplete="username"><input type="password" autocomplete="new-password"></form>',
      1,
      1,
    ],
    [
      '<form><input type="password"><input type="password"></form><form><input type="email"><input type="password"></form>',
      3,
      1,
    ],
  ])("detects deterministic structure %#", (markup, passwords, usernames) => {
    setBody(markup);
    expect(detectLoginForms(document)).toMatchObject({
      hasLoginForm: true,
      passwordFieldCount: passwords,
      usernameCandidateCount: usernames,
    });
  });

  test.each(["disabled", "readonly", "hidden"])(
    "rejects %s password fields",
    (attribute) => {
      setBody(`<form><input type="password" ${attribute}></form>`);
      expect(detectLoginForms(document).hasLoginForm).toBe(false);
    },
  );

  test("rejects explicitly CSS-hidden password fields without layout heuristics", () => {
    setBody('<form><input type="password" style="display: none"></form>');
    expect(detectLoginForms(document).hasLoginForm).toBe(false);
  });

  test("does not serialize or reveal an existing field value", () => {
    setBody('<form><input type="email"><input type="password"></form>');
    const password = document.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    expect(password).not.toBeNull();
    if (password !== null) password.value = "SECRET_MUST_NOT_BE_READ";
    expect(JSON.stringify(detectLoginForms(document))).not.toContain(
      "SECRET_MUST_NOT_BE_READ",
    );
  });
});
