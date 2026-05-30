import React from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import App from "./App";
import "./styles.css";
import "@xyflow/react/dist/style.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("ThreeFX Studio root element was not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  </React.StrictMode>,
);
