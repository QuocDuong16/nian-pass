import browser from "webextension-polyfill";

import "./popup.css";

import {
  PROTOCOL_VERSION,
  parseActionResult,
  parseSiteStatus,
  type PopupToBackground,
  type SiteStatus,
} from "./protocol";

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

async function send(message: PopupToBackground): Promise<unknown> {
  return browser.runtime.sendMessage(message);
}

function render(status: SiteStatus): void {
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

async function changePermission(
  type: "enableSite" | "disableSite",
): Promise<void> {
  errorText.textContent = "";
  const result = parseActionResult(
    await send({ protocolVersion: PROTOCOL_VERSION, type }),
  );
  if (result?.ok !== true) {
    errorText.textContent =
      type === "enableSite"
        ? "Could not enable Nian Pass on this site."
        : "Could not disable Nian Pass on this site.";
    return;
  }
  await refresh();
}

enableButton.addEventListener("click", () => {
  void changePermission("enableSite").catch(() => {
    errorText.textContent = "Could not enable Nian Pass on this site.";
  });
});
disableButton.addEventListener("click", () => {
  void changePermission("disableSite").catch(() => {
    errorText.textContent = "Could not disable Nian Pass on this site.";
  });
});

void refresh().catch(() => {
  permissionText.textContent = "Nian Pass is unavailable on this page.";
  detectionText.textContent = "Page detection is unavailable.";
});
