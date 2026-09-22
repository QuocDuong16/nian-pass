import { afterEach, expect, test, vi } from "vitest";

import wordlistSource from "./eff-large.wordlist?raw";
import {
  generatePassphrase,
  MAX_PASSPHRASE_WORDS,
  MIN_PASSPHRASE_WORDS,
  PASSPHRASE_WORD_COUNT,
  type PassphraseOptions,
} from "./passphrase-generation";

const wordlist = wordlistSource.trim().split("\n");
const defaults: PassphraseOptions = {
  words: 6,
  separator: "-",
  capitalize: false,
};

afterEach(() => vi.restoreAllMocks());

test("bundled wordlist is complete, unique and offline-friendly", () => {
  expect(PASSPHRASE_WORD_COUNT).toBe(7772);
  expect(wordlist).toHaveLength(7772);
  expect(new Set(wordlist).size).toBe(7772);
  expect(wordlist.every((word) => /^[a-z]+$/u.test(word))).toBe(true);
});

test("generates six independently chosen dictionary words by default", () => {
  const phrase = generatePassphrase(defaults);
  const words = phrase.split("-");
  expect(words).toHaveLength(6);
  expect(words.every((word) => wordlist.includes(word))).toBe(true);
});

test("separator and capitalization are formatting, never a changed word selection", () => {
  const phrase = generatePassphrase({
    words: 12,
    separator: " ",
    capitalize: true,
  });
  const words = phrase.split(" ");
  expect(words).toHaveLength(12);
  expect(
    words.every(
      (word) =>
        /^[A-Z][a-z]*$/u.test(word) && wordlist.includes(word.toLowerCase()),
    ),
  ).toBe(true);
});

test("rejects weak and invalid counts and unrecognized separators", () => {
  for (const words of [
    MIN_PASSPHRASE_WORDS - 1,
    MAX_PASSPHRASE_WORDS + 1,
    6.5,
    NaN,
    Infinity,
  ]) {
    expect(() => generatePassphrase({ ...defaults, words })).toThrow(
      "Invalid passphrase options or wordlist",
    );
  }
  expect(() =>
    generatePassphrase({
      ...defaults,
      separator: "_" as PassphraseOptions["separator"],
    }),
  ).toThrow("Invalid passphrase options or wordlist");
});

test("rejects 16-bit samples outside unbiased cutoff and permits repeated words", () => {
  let calls = 0;
  const random = vi.spyOn(globalThis.crypto, "getRandomValues");
  random.mockImplementation((array) => {
    expect(array).toBeInstanceOf(Uint16Array);
    if (array instanceof Uint16Array) {
      array[0] = calls === 0 ? 65535 : 0;
    }
    calls += 1;
    return array;
  });

  const words = generatePassphrase(defaults).split("-");
  expect(words).toEqual(Array.from({ length: 6 }, () => wordlist[0]));
  expect(calls).toBe(7);
});

test("cryptographic RNG failure propagates rather than falling back to Math.random", () => {
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => {
    throw new Error("secure RNG unavailable");
  });
  expect(() => generatePassphrase(defaults)).toThrow("secure RNG unavailable");
});
