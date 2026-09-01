import type {
  BackgroundAuthority,
  PopupIntegration,
} from "./background-authority";
import type { BackgroundChannelRegistry } from "./background-channel";
import type { NativeClient } from "./background-native";
import {
  CandidateAuthorityStore,
  candidateMatches,
  type CurrentCredentialContext,
} from "./candidate-authority";
import { PROTOCOL_VERSION } from "./protocol";
import type {
  BrowserIntegrationStatus,
  FillCandidateResult,
  PopupCandidate,
  PopupToBackground,
} from "./popup-protocol";
import type { NativeErrorCode } from "./native-protocol";

export class BrowserIntegration implements PopupIntegration {
  readonly #candidates = new CandidateAuthorityStore();

  constructor(
    private readonly authority: BackgroundAuthority,
    private readonly channels: BackgroundChannelRegistry,
    private readonly native: NativeClient,
  ) {}

  async handlePopup(
    message: Exclude<PopupToBackground, { type: "getSiteStatus" }>,
  ): Promise<unknown> {
    switch (message.type) {
      case "connectDesktop":
        return this.#connect();
      case "listCandidates":
        return this.#listCandidates();
      case "fillCandidate":
        return this.#fill(message.candidateHandle);
    }
  }

  clearTab(tabId: number): void {
    this.#candidates.clearTab(tabId);
  }

  clearAll(): void {
    this.#candidates.clearAll();
  }

  async #connect(): Promise<BrowserIntegrationStatus> {
    const connection = await this.native.connect();
    return this.#status(connection, [], false, null);
  }

  async #listCandidates(): Promise<BrowserIntegrationStatus> {
    if (this.native.generation === null) {
      return this.#status("disconnected", [], false, "desktopUnavailable");
    }
    const context = await this.#currentContext();
    if (context === null) {
      return this.#status(this.native.state, [], false, "unsupportedTarget");
    }
    const listingGeneration = this.#candidates.beginListing(context.page.tabId);
    const generation = context.nativeGeneration;
    const response = await this.native.candidates(context.page.origin);
    if (
      response === null ||
      this.native.generation !== generation ||
      !this.#candidates.isCurrentListing(
        context.page.tabId,
        listingGeneration,
      ) ||
      !(await this.#matchesCurrent(context))
    ) {
      return this.#status(this.native.state, [], false, "internal");
    }
    if (response.type === "error") {
      if (response.code === "locked") this.clearAll();
      return this.#status(
        response.code === "locked" ? "locked" : this.native.state,
        [],
        false,
        mapNativeError(response.code),
      );
    }
    if (response.type !== "candidates") {
      return this.#status(this.native.state, [], false, "internal");
    }
    this.#candidates.replaceVaultSession(response.vaultSessionId);
    const candidates = response.candidates.map((candidate) =>
      this.#candidates.authorize(candidate, response.vaultSessionId, context),
    );
    return this.#status(
      "ready",
      candidates,
      response.truncated,
      candidates.length === 0 ? "noMatches" : null,
    );
  }

  async #fill(candidateHandle: string): Promise<FillCandidateResult> {
    const candidate = this.#candidates.consume(candidateHandle);
    if (candidate === null) return this.#fillResult(false);
    const context = await this.#currentContext();
    if (context === null || !candidateMatches(candidate, context)) {
      return this.#fillResult(false);
    }
    if (this.native.generation !== candidate.nativeGeneration) {
      return this.#fillResult(false);
    }
    const response = await this.native.credential(
      candidate.origin,
      candidate.vaultSessionId,
      candidate.entryId,
    );
    if (
      response?.type !== "credential" ||
      this.native.generation !== candidate.nativeGeneration
    ) {
      return this.#fillResult(false);
    }
    const current = await this.#currentContext();
    if (current === null || !candidateMatches(candidate, current)) {
      return this.#fillResult(false);
    }
    current.channel.port.postMessage({
      protocolVersion: PROTOCOL_VERSION,
      type: "applyCredential",
      documentNonce: candidate.documentNonce,
      usernameFieldHandle: candidate.usernameFieldHandle,
      passwordFieldHandle: candidate.passwordFieldHandle,
      username: response.username,
      password: response.password,
    });
    return this.#fillResult(true);
  }

  async #currentContext(): Promise<CurrentCredentialContext | null> {
    const page = await this.authority.activeCredentialContext();
    const nativeGeneration = this.native.generation;
    if (page === null || nativeGeneration === null) return null;
    const channel = this.channels.authorityFor(
      page.tabId,
      0,
      page.documentNonce,
    );
    if (channel?.origin !== page.origin) return null;
    return { page, channel, nativeGeneration };
  }

  async #matchesCurrent(expected: CurrentCredentialContext): Promise<boolean> {
    const current = await this.#currentContext();
    return (
      current !== null &&
      current.page.tabId === expected.page.tabId &&
      current.page.origin === expected.page.origin &&
      current.page.documentNonce === expected.page.documentNonce &&
      current.page.fillTarget.usernameFieldHandle ===
        expected.page.fillTarget.usernameFieldHandle &&
      current.page.fillTarget.passwordFieldHandle ===
        expected.page.fillTarget.passwordFieldHandle &&
      current.channel.port === expected.channel.port &&
      current.nativeGeneration === expected.nativeGeneration
    );
  }

  #status(
    connection: BrowserIntegrationStatus["connection"],
    candidates: PopupCandidate[],
    truncated: boolean,
    error: BrowserIntegrationStatus["error"],
  ): BrowserIntegrationStatus {
    return {
      protocolVersion: PROTOCOL_VERSION,
      type: "browserIntegrationStatus",
      connection,
      candidates,
      truncated,
      error,
    };
  }

  #fillResult(success: boolean): FillCandidateResult {
    return {
      protocolVersion: PROTOCOL_VERSION,
      type: "fillCandidateResult",
      success,
    };
  }
}

function mapNativeError(
  code: NativeErrorCode,
): BrowserIntegrationStatus["error"] {
  switch (code) {
    case "desktopUnavailable":
    case "denied":
    case "locked":
    case "noMatches":
    case "unsupportedTarget":
    case "internal":
      return code;
    case "approvalRequired":
    case "invalidRequest":
      return "internal";
  }
}
