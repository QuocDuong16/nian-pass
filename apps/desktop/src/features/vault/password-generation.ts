export interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

const SETS = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
} as const;

function allowedCharacters(source: string, avoidAmbiguous: boolean): string {
  return avoidAmbiguous ? source.replace(/[Il1O0o|`'"]/gu, "") : source;
}

function secureIndex(upperExclusive: number): number {
  if (
    !Number.isSafeInteger(upperExclusive) ||
    upperExclusive <= 0 ||
    upperExclusive > 256
  ) {
    throw new Error("Invalid password alphabet size");
  }
  const cutoff = 256 - (256 % upperExclusive);
  const value = new Uint8Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while ((value[0] ?? 255) >= cutoff);
  return (value[0] ?? 0) % upperExclusive;
}

export function generatePassword(options: GeneratorOptions): string {
  const selected = (Object.keys(SETS) as (keyof typeof SETS)[])
    .filter((key) => options[key])
    .map((key) => allowedCharacters(SETS[key], options.avoidAmbiguous));
  if (selected.length === 0) {
    throw new Error("Select at least one character set");
  }
  const length = Math.max(
    selected.length,
    Math.min(128, Math.max(8, options.length)),
  );
  const combined = selected.join("");
  const output = selected.map(
    (characters) => characters[secureIndex(characters.length)] ?? "",
  );
  while (output.length < length) {
    output.push(combined[secureIndex(combined.length)] ?? "");
  }
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = secureIndex(index + 1);
    [output[index], output[swap]] = [output[swap] ?? "", output[index] ?? ""];
  }
  return output.join("");
}
