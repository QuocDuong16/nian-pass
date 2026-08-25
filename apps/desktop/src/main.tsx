import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { desktopWindowLifecycle } from "./lib/window-lifecycle";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Nian Pass root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App windowLifecycle={desktopWindowLifecycle} />
    </ErrorBoundary>
  </StrictMode>,
);
