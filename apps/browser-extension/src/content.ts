import browser from "webextension-polyfill";

import { DetectionController } from "./content/detection-controller";
import { FieldRegistry } from "./content/field-registry";
import { parseApplyCredential } from "./protocol";

const fields = new FieldRegistry(document);
const detector = new DetectionController(
  document,
  fields.documentNonce,
  (message) => browser.runtime.sendMessage(message).then(() => undefined),
);

interface ExtensionSender {
  id?: string;
  tab?: unknown;
}

browser.runtime.onMessage.addListener(
  (message: unknown, sender: ExtensionSender) => {
    if (sender.id !== browser.runtime.id || sender.tab !== undefined)
      return undefined;
    const command = parseApplyCredential(message);
    return command === null
      ? undefined
      : Promise.resolve(fields.apply(command));
  },
);

detector.start();
