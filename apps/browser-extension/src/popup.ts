import browser from "webextension-polyfill";

import "./popup.css";

import {
  PROTOCOL_VERSION,
  parseSiteStatus,
  type PopupToBackground,
  type SiteStatus,
} from "./protocol";
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

async function refresh(): Promise<void> {
  const response = parseSiteStatus(
    await send({ protocolVersion: PROTOCOL_VERSION, type: "getSiteStatus" }),
  );
  if (response === null) throw new Error("Invalid site status");
  render(response);
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

void refresh().catch(() => {
  permissionText.textContent = "Nian Pass is unavailable on this page.";
  detectionText.textContent = "Page detection is unavailable.";
});
