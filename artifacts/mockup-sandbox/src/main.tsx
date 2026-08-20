import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline shell just won't be available this session — the app still works online.
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
