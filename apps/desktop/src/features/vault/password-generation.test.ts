import { expect, test } from "vitest";

import { generatePassword, type GeneratorOptions } from "./password-generation";

const defaults: GeneratorOptions = {
  length: 24,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: true,
};

test("generated passwords include every selected character class", () => {
  const password = generatePassword(defaults);

  expect(password).toHaveLength(24);
  expect(password).toMatch(/[A-Z]/u);
  expect(password).toMatch(/[a-z]/u);
  expect(password).toMatch(/\d/u);
  expect(password).toMatch(/[^A-Za-z0-9]/u);
  expect(password).not.toMatch(/[Il1O0o]/u);
});

test("rejects invalid lengths rather than generating a short password", () => {
  for (const length of [
    0,
    1,
    7,
    129,
    999,
    8.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    expect(() => generatePassword({ ...defaults, length })).toThrow(
      "Password length must be between 8 and 128",
    );
  }
  expect(generatePassword({ ...defaults, length: 8 })).toHaveLength(8);
  expect(generatePassword({ ...defaults, length: 128 })).toHaveLength(128);
});

test("generation fails closed when no character set is selected", () => {
  expect(() =>
    generatePassword({
      ...defaults,
      uppercase: false,
      lowercase: false,
      digits: false,
      symbols: false,
    }),
  ).toThrow("Select at least one character set");
});
