import browser from "webextension-polyfill";

import "./popup.css";

import { PROTOCOL_VERSION } from "./protocol";
import {
  parseBrowserIntegrationStatus,
  parseFillCandidateResult,
  parseSiteStatus,
  type BrowserIntegrationStatus,
  type CandidateText,
  type PopupToBackground,
  type SiteStatus,
} from "./popup-protocol";
import { createPopupPermissionApi } from "./popup-permissions";

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing popup element: ${id}`);
  return element;
}

const siteText = requiredElement("site");
const permissionText = requiredElement("permission");
const detectionText = requiredElement("detection");
const errorText = requiredElement("error");
const desktopText = requiredElement("desktop");
const candidatesElement = requiredElement("candidates");
const connectButton = requiredElement("connect") as HTMLButtonElement;
const enableButton = requiredElement("enable") as HTMLButtonElement;
const disableButton = requiredElement("disable") as HTMLButtonElement;
const permissionApi = createPopupPermissionApi(browser);
let currentStatus: SiteStatus | null = null;

async function send(message: PopupToBackground): Promise<unknown> {
  return browser.runtime.sendMessage(message);
}

function render(status: SiteStatus): void {
  currentStatus = status;
  siteText.textContent =
    status.site === null
      ? "Current site: unavailable"
      : `Current site: ${status.site.host}`;
  permissionText.textContent =
    status.permission === "unsupported"
      ? "Nian Pass is unavailable on this page."
      : status.permission === "enabled"
        ? "Enabled"
        : "Disabled";
  const detection = {
    detected: "Login form detected",
    notDetected: "Login form not detected",
    waiting: "Waiting for page detection",
    unavailable: "Page detection is unavailable",
  } as const;
  detectionText.textContent = detection[status.detection];
  enableButton.hidden = status.permission !== "disabled";
  disableButton.hidden = status.permission !== "enabled";
  enableButton.disabled = status.permission === "unsupported";
  disableButton.disabled = status.permission === "unsupported";
}

function candidateText(value: CandidateText): string {
  return value.kind === "visible" ? value.value : "Protected";
}

function renderIntegration(status: BrowserIntegrationStatus): void {
  const labels = {
    disconnected: "Disconnected",
    waiting: "Waiting for desktop approval",
    connected: "Connected",
    locked: "Vault locked",
    ready: "Ready",
  } as const;
  desktopText.textContent = labels[status.connection];
  connectButton.hidden = status.connection !== "disconnected";
  candidatesElement.replaceChildren();
  for (const candidate of status.candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate";
    button.textContent = `${candidateText(candidate.title)} — ${candidateText(candidate.username)}`;
    button.addEventListener("click", () => {
      button.disabled = true;
      errorText.textContent = "";
      void send({
        protocolVersion: PROTOCOL_VERSION,
        type: "fillCandidate",
        candidateHandle: candidate.candidateHandle,
      })
        .then((response) => {
          const result = parseFillCandidateResult(response);
          errorText.textContent =
            result?.success === true
              ? "Credential filled. Submit the form when ready."
              : "Could not fill this credential.";
        })
        .catch(() => {
          errorText.textContent = "Could not fill this credential.";
        });
    });
    candidatesElement.append(button);
  }
  if (status.error !== null) {
    const errors = {
      desktopUnavailable: "Nian Pass desktop is not connected.",
      denied: "The browser connection was denied.",
      locked: "Unlock your vault in Nian Pass.",
      noMatches: "No matching credentials.",
      unsupportedTarget: "Credential filling is unavailable on this page.",
      internal: "Could not load credentials from Nian Pass.",
    } as const;
    errorText.textContent = errors[status.error];
  }
}

async function refreshIntegration(): Promise<void> {
  const status = parseBrowserIntegrationStatus(
    await send({ protocolVersion: PROTOCOL_VERSION, type: "listCandidates" }),
  );
  if (status === null) throw new Error("Invalid browser integration status");
  renderIntegration(status);
}

async function refresh(): Promise<void> {
  const response = parseSiteStatus(
    await send({ protocolVersion: PROTOCOL_VERSION, type: "getSiteStatus" }),
  );
  if (response === null) throw new Error("Invalid site status");
  render(response);
  if (response.permission === "enabled") await refreshIntegration();
  else {
    candidatesElement.replaceChildren();
  }
}

function finishPermissionChange(
  operation: Promise<boolean>,
  failureMessage: string,
): void {
  void operation
    .then(async (changed) => {
      if (!changed) errorText.textContent = failureMessage;
      await refresh();
    })
    .catch(() => {
      errorText.textContent = failureMessage;
    });
}

enableButton.addEventListener("click", () => {
  const pattern = currentStatus?.site?.permissionPattern;
  if (pattern === undefined) return;
  errorText.textContent = "";
  try {
    finishPermissionChange(
      permissionApi.requestOrigin(pattern),
      "Could not enable Nian Pass on this site.",
    );
  } catch {
    errorText.textContent = "Could not enable Nian Pass on this site.";
  }
});
disableButton.addEventListener("click", () => {
  const pattern = currentStatus?.site?.permissionPattern;
  if (pattern === undefined) return;
  errorText.textContent = "";
  try {
    finishPermissionChange(
      permissionApi.removeOrigin(pattern),
      "Could not disable Nian Pass on this site.",
    );
  } catch {
    errorText.textContent = "Could not disable Nian Pass on this site.";
  }
});
connectButton.addEventListener("click", () => {
  errorText.textContent = "";
  desktopText.textContent = "Waiting for desktop approval";
  connectButton.hidden = true;
  void send({ protocolVersion: PROTOCOL_VERSION, type: "connectDesktop" })
    .then((response) => {
      const status = parseBrowserIntegrationStatus(response);
      if (status === null) throw new Error("Invalid connection status");
      renderIntegration(status);
      if (status.connection === "ready" || status.connection === "locked") {
        void refreshIntegration().catch(() => {
          errorText.textContent = "Could not load credentials from Nian Pass.";
        });
      }
    })
    .catch(() => {
      desktopText.textContent = "Disconnected";
      connectButton.hidden = false;
      errorText.textContent = "Nian Pass desktop is not connected.";
    });
});

void refresh().catch(() => {
  permissionText.textContent = "Nian Pass is unavailable on this page.";
  detectionText.textContent = "Page detection is unavailable.";
});
