import browser from "webextension-polyfill";

import {
  BackgroundAuthority,
  type MessageSender,
} from "./background-authority";
import { browserApi } from "./browser-binding";
import { BackgroundChannelRegistry } from "./background-channel";

const authority = new BackgroundAuthority(browserApi);
const channels = new BackgroundChannelRegistry(browserApi);
let reconciliation = Promise.resolve();

function scheduleReconciliation(): void {
  reconciliation = reconciliation.then(
    () => authority.reconcile(),
    () => authority.reconcile(),
  );
  void reconciliation.catch(() => undefined);
}

browser.runtime.onMessage.addListener(
  (message: unknown, sender: MessageSender) =>
    authority.handleMessage(message, sender),
);
browser.runtime.onConnect.addListener((port) => {
  channels.accept(port);
});
browser.runtime.onInstalled.addListener(scheduleReconciliation);
browser.runtime.onStartup.addListener(scheduleReconciliation);
browser.permissions.onAdded.addListener(scheduleReconciliation);
browser.permissions.onRemoved.addListener(() => {
  authority.clearEphemeralState();
  channels.clearAll();
  scheduleReconciliation();
});
browser.tabs.onRemoved.addListener((tabId) => {
  authority.clearTab(tabId);
  channels.clearTab(tabId);
});
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url !== undefined) {
    authority.clearTab(tabId);
    channels.clearTab(tabId);
  }
});
