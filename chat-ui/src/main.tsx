import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app";
import "@fontsource-variable/geist";
import "@/index.css";
import "@/widget-design.css";
import "leaflet/dist/leaflet.css";

const root = document.getElementById("alpharecall-chat-root");
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
