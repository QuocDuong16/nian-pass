import wordlistSource from "./eff-large.wordlist?raw";

// Bundled, modified EFF large wordlist distributed with KeePassXC. Never fetch
// dictionary contents at runtime or persist generated passwords/passphrases.
const WORDS = wordlistSource.trim().split("\n");

export const PASSPHRASE_WORD_COUNT = WORDS.length;
export const MIN_PASSPHRASE_WORDS = 6;
export const MAX_PASSPHRASE_WORDS = 12;

export interface PassphraseOptions {
  words: number;
  separator: " " | "-";
  capitalize: boolean;
}

export function generatePassphrase(options: PassphraseOptions): string {
  if (
    !Number.isSafeInteger(options.words) ||
    options.words < MIN_PASSPHRASE_WORDS ||
    options.words > MAX_PASSPHRASE_WORDS ||
    ![" ", "-"].includes(options.separator) ||
    typeof options.capitalize !== "boolean" ||
    WORDS.length !== 7772
  ) {
    throw new Error("Invalid passphrase options or wordlist");
  }

  // 16-bit rejection sampling avoids modulo bias for the 7,772-word alphabet.
  // Repeats are allowed: forbidding them would change the selection model.
  const cutoff = 65536 - (65536 % WORDS.length);
  const random = new Uint16Array(1);
  const result: string[] = [];
  for (let index = 0; index < options.words; index += 1) {
    let sample: number;
    do {
      globalThis.crypto.getRandomValues(random);
      sample = random[0] ?? 65535;
    } while (sample >= cutoff);
    const word = WORDS[sample % WORDS.length];
    if (word === undefined || !/^[a-z]+$/u.test(word)) {
      throw new Error("Invalid passphrase wordlist");
    }
    result.push(
      options.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    );
  }
  return result.join(options.separator);
}
