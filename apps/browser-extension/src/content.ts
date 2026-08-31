import browser from "webextension-polyfill";

import { ContentChannel } from "./content-channel";
import { DetectionController } from "./content/detection-controller";
import { FieldRegistry } from "./content/field-registry";

const fields = new FieldRegistry(document);
const detector = new DetectionController(
  document,
  fields.documentNonce,
  (message) => browser.runtime.sendMessage(message).then(() => undefined),
);

const channel = new ContentChannel({
  documentNonce: fields.documentNonce,
  connect: (name) => browser.runtime.connect({ name }),
  apply: (command) => {
    fields.apply(command);
  },
  isCurrentDocument: () => document.documentElement.isConnected,
});

channel.start();
detector.start();
