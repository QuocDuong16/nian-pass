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

test("generation clamps requested lengths without dropping the selected alphabet", () => {
  const short = generatePassword({
    ...defaults,
    length: 1,
    lowercase: false,
    digits: false,
    symbols: false,
    avoidAmbiguous: false,
  });
  const long = generatePassword({
    ...defaults,
    length: 999,
    uppercase: false,
    lowercase: false,
    symbols: false,
  });

  expect(short).toHaveLength(8);
  expect(short).toMatch(/^[A-Z]+$/u);
  expect(long).toHaveLength(128);
  expect(long).toMatch(/^\d+$/u);
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
