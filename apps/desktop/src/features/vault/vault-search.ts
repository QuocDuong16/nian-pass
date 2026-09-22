import type {
  EntrySummaryDto,
  GroupDto,
  SummaryTextDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import { isGroupInRecycleBin } from "./recycle-bin";

type Filter =
  | { kind: "tag" | "group"; value: string }
  | { kind: "has"; value: "totp" | "password" | "notes" }
  | { kind: "is"; value: "expired" | "expiring" | "protected" };

const EXPIRING_WINDOW_SECONDS = 30 * 24 * 60 * 60;

function tokenize(query: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  for (const character of query) {
    if (character === '"') {
      quoted = !quoted;
    } else if (/\s/u.test(character) && !quoted) {
      if (token !== "") tokens.push(token);
      token = "";
    } else {
      token += character;
    }
  }
  // A partial quote should never turn a broad filter into an accidental match.
  if (quoted) return null;
  if (token !== "") tokens.push(token);
  return tokens;
}

function parseQuery(query: string): { text: string; filters: Filter[] } {
  const tokens = tokenize(query);
  if (tokens === null) {
    return { text: query.trim().toLocaleLowerCase(), filters: [] };
  }
  const filters: Filter[] = [];
  const plain: string[] = [];
  for (const token of tokens) {
    const colon = token.indexOf(":");
    const kind = token.slice(0, colon).toLocaleLowerCase();
    const value = token.slice(colon + 1).toLocaleLowerCase();
    if (colon >= 0 && (kind === "tag" || kind === "group")) {
      filters.push({ kind, value });
    } else if (
      kind === "has" &&
      (value === "totp" || value === "password" || value === "notes")
    ) {
      filters.push({ kind, value });
    } else if (
      kind === "is" &&
      (value === "expired" || value === "expiring" || value === "protected")
    ) {
      filters.push({ kind, value });
    } else {
      plain.push(token);
    }
  }
  return {
    // Preserve existing phrase/substring matching for ordinary unquoted queries.
    text: (filters.length === 0 && !query.includes('"')
      ? query.trim()
      : plain.join(" ")
    ).toLocaleLowerCase(),
    filters,
  };
}

function visibleText(value: SummaryTextDto): string {
  return value.kind === "visible" ? value.value : "";
}

function matchesFilter(
  entry: EntrySummaryDto,
  groupName: string,
  filter: Filter,
  now: number,
): boolean {
  switch (filter.kind) {
    case "tag":
      return (
        filter.value !== "" &&
        entry.tags.some((tag) => tag.toLocaleLowerCase() === filter.value)
      );
    case "group":
      return (
        filter.value !== "" &&
        groupName.toLocaleLowerCase().includes(filter.value)
      );
    case "has":
      switch (filter.value) {
        case "totp":
          return entry.totpPresent;
        case "password":
          return entry.passwordPresent;
        case "notes":
          return entry.notesPresent;
      }
      break;
    case "is":
      switch (filter.value) {
        case "expired":
          return (
            entry.expiresAtUnixSeconds !== null &&
            entry.expiresAtUnixSeconds <= now
          );
        case "expiring":
          return (
            entry.expiresAtUnixSeconds !== null &&
            entry.expiresAtUnixSeconds > now &&
            entry.expiresAtUnixSeconds <= now + EXPIRING_WINDOW_SECONDS
          );
        case "protected":
          return (
            entry.title.kind === "protected" ||
            entry.username.kind === "protected" ||
            entry.url.kind === "protected"
          );
      }
  }
}

/** Read-only search over validated summary metadata. No secret reveal or IPC. */
export function searchVault(
  snapshot: VaultSnapshotDto,
  groupsById: ReadonlyMap<string, GroupDto>,
  query: string,
  now = Math.floor(Date.now() / 1000),
): EntrySummaryDto[] | null {
  if (query.trim() === "") return null;
  const { text, filters } = parseQuery(query);
  // A quote-only query is not an empty search and must not list every entry.
  if (text === "" && filters.length === 0) return [];
  return snapshot.entries.filter((entry) => {
    if (isGroupInRecycleBin(snapshot, entry.groupId)) return false;
    const groupName = groupsById.get(entry.groupId)?.name ?? "";
    if (
      !filters.every((filter) => matchesFilter(entry, groupName, filter, now))
    ) {
      return false;
    }
    if (text === "") return true;
    return [
      visibleText(entry.title),
      visibleText(entry.username),
      visibleText(entry.url),
      ...entry.tags,
      groupName,
    ].some((value) => value.toLocaleLowerCase().includes(text));
  });
}
