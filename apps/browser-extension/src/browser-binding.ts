import browser from "webextension-polyfill";

import { createBrowserApi } from "./browser-api";

export const browserApi = createBrowserApi(browser);
