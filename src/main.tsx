import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Register service worker for PWA offline support + push notifications
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("Service worker registration failed:", err);
  });

  // Listen for navigation messages from service worker (notification click)
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "navigate" && event.data?.url) {
      window.location.href = event.data.url;
    }
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
