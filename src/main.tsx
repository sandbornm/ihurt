import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/dm-sans";
import App from "./App";
import "./styles.css";
import "./responsive.css";
import "./theme.css";
import { initializeNativeApp } from "./platform/native";

initializeNativeApp();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
