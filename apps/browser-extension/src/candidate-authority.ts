import type { ActiveCredentialContext } from "./background-authority";
import type { DocumentPortAuthority } from "./background-channel";
import type { NativeCandidate } from "./native-protocol";
import type { PopupCandidate } from "./popup-protocol";

export interface CurrentCredentialContext {
  page: ActiveCredentialContext;
  channel: DocumentPortAuthority;
  nativeGeneration: string;
}

export interface CandidateAuthority {
  entryId: string;
  vaultSessionId: string;
  tabId: number;
  origin: string;
  documentNonce: string;
  usernameFieldHandle: string | null;
  passwordFieldHandle: string;
  contentPort: DocumentPortAuthority["port"];
  nativeGeneration: string;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export class CandidateAuthorityStore {
  readonly #candidates = new Map<string, CandidateAuthority>();
  readonly #listings = new Map<number, string>();
  #vaultSessionId: string | null = null;

  clearTab(tabId: number): void {
    for (const [handle, candidate] of this.#candidates) {
      if (candidate.tabId === tabId) this.#candidates.delete(handle);
    }
    this.#listings.delete(tabId);
  }

  clearAll(): void {
    this.#candidates.clear();
    this.#listings.clear();
    this.#vaultSessionId = null;
  }

  beginListing(tabId: number): string {
    this.clearTab(tabId);
    const generation = randomToken();
    this.#listings.set(tabId, generation);
    return generation;
  }

  isCurrentListing(tabId: number, generation: string): boolean {
    return this.#listings.get(tabId) === generation;
  }

  replaceVaultSession(vaultSessionId: string): void {
    if (
      this.#vaultSessionId !== null &&
      this.#vaultSessionId !== vaultSessionId
    ) {
      this.#candidates.clear();
    }
    this.#vaultSessionId = vaultSessionId;
  }

  authorize(
    native: NativeCandidate,
    vaultSessionId: string,
    context: CurrentCredentialContext,
  ): PopupCandidate {
    let candidateHandle = randomToken();
    while (this.#candidates.has(candidateHandle)) {
      candidateHandle = randomToken();
    }
    this.#candidates.set(candidateHandle, {
      entryId: native.entryId,
      vaultSessionId,
      tabId: context.page.tabId,
      origin: context.page.origin,
      documentNonce: context.page.documentNonce,
      usernameFieldHandle: context.page.fillTarget.usernameFieldHandle,
      passwordFieldHandle: context.page.fillTarget.passwordFieldHandle,
      contentPort: context.channel.port,
      nativeGeneration: context.nativeGeneration,
    });
    return {
      candidateHandle,
      title: native.title,
      username: native.username,
    };
  }

  consume(handle: string): CandidateAuthority | null {
    const candidate = this.#candidates.get(handle) ?? null;
    this.#candidates.delete(handle);
    return candidate;
  }
}

export function candidateMatches(
  candidate: CandidateAuthority,
  current: CurrentCredentialContext,
): boolean {
  return (
    candidate.tabId === current.page.tabId &&
    candidate.origin === current.page.origin &&
    candidate.documentNonce === current.page.documentNonce &&
    candidate.usernameFieldHandle ===
      current.page.fillTarget.usernameFieldHandle &&
    candidate.passwordFieldHandle ===
      current.page.fillTarget.passwordFieldHandle &&
    candidate.contentPort === current.channel.port &&
    candidate.nativeGeneration === current.nativeGeneration
  );
}
