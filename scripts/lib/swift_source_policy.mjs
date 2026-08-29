function blank(character) {
  return character === "\n" || character === "\r" ? character : " ";
}

export function stripSwiftComments(source) {
  let result = "";
  let index = 0;
  let blockDepth = 0;
  let quote = null;

  while (index < source.length) {
    const next = source.slice(index, index + 3);
    const pair = source.slice(index, index + 2);
    const character = source[index];

    if (blockDepth > 0) {
      if (pair === "/*") {
        blockDepth += 1;
        result += "  ";
        index += 2;
      } else if (pair === "*/") {
        blockDepth -= 1;
        result += "  ";
        index += 2;
      } else {
        result += blank(character);
        index += 1;
      }
      continue;
    }

    if (quote !== null) {
      if (character === "\\" && quote === '"') {
        result += source.slice(index, index + 2);
        index += 2;
      } else if (quote === '"""' && next === quote) {
        result += quote;
        index += quote.length;
        quote = null;
      } else if (quote === '"' && character === quote) {
        result += character;
        index += 1;
        quote = null;
      } else {
        result += character;
        index += 1;
      }
      continue;
    }

    if (next === '"""') {
      quote = next;
      result += next;
      index += next.length;
    } else if (character === '"') {
      quote = character;
      result += character;
      index += 1;
    } else if (pair === "//") {
      result += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        result += " ";
        index += 1;
      }
    } else if (pair === "/*") {
      blockDepth = 1;
      result += "  ";
      index += 2;
    } else {
      result += character;
      index += 1;
    }
  }

  return result;
}

export function maskSwiftStrings(source) {
  let result = "";
  let index = 0;
  let quote = null;

  while (index < source.length) {
    const next = source.slice(index, index + 3);
    const character = source[index];

    if (quote !== null) {
      if (character === "\\" && quote === '"') {
        result += "  ";
        index += 2;
      } else if (quote === '"""' && next === quote) {
        result += " ".repeat(quote.length);
        index += quote.length;
        quote = null;
      } else if (quote === '"' && character === quote) {
        result += " ";
        index += 1;
        quote = null;
      } else {
        result += blank(character);
        index += 1;
      }
      continue;
    }

    if (next === '"""') {
      quote = next;
      result += " ".repeat(next.length);
      index += next.length;
    } else if (character === '"') {
      quote = character;
      result += " ";
      index += 1;
    } else {
      result += character;
      index += 1;
    }
  }

  return result;
}

export function swiftExecutableText(source) {
  return maskSwiftStrings(stripSwiftComments(source));
}

export function hasSwiftCall(source, symbol) {
  const calls = source.matchAll(new RegExp(`\\b${symbol}\\s*\\(`, "gu"));
  for (const call of calls) {
    const prefix = source.slice(Math.max(0, call.index - 80), call.index);
    if (!/\bfunc\s*$/u.test(prefix)) return true;
  }
  return false;
}

function resolvedBoolean(source, value) {
  if (["false", "kCFBooleanFalse"].includes(value)) return false;
  if (["true", "kCFBooleanTrue"].includes(value)) return true;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const assignment = source.match(
    new RegExp(
      `\\b(?:let|var)\\s+${escaped}\\b(?:\\s*:[^=\\n]+)?\\s*=\\s*(false|true|kCFBooleanFalse|kCFBooleanTrue)\\b`,
      "u",
    ),
  );
  return assignment ? resolvedBoolean(source, assignment[1]) : null;
}

export function synchronizablePolicy(source) {
  const valuePatterns = [
    /\bkSecAttrSynchronizable(?:\s+as\s+String)?\s*:\s*([A-Za-z_]\w*|false|true)\b/gu,
    /\[\s*kSecAttrSynchronizable(?:\s+as\s+String)?\s*\]\s*=\s*([A-Za-z_]\w*|false|true)\b/gu,
  ];
  const values = valuePatterns.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) =>
      resolvedBoolean(source, match[1]),
    ),
  );
  return { hasFalse: values.includes(false), hasTrue: values.includes(true) };
}
