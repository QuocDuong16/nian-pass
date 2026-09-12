import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ApplicationRoot } from "./app/ApplicationRoot";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./styles.css";
import "./product-ui.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Nian Pass root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <ApplicationRoot />
    </ErrorBoundary>
  </StrictMode>,
);
