import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getConnection } from "./bridge";
import { useStore } from "./store";
import "./app.css";

// Dev-only handle for the e2e checks in scripts/e2e and for poking at state in devtools.
if (import.meta.env.DEV) Object.assign(window, { __store: useStore, __bridge: { getConnection } });

// No StrictMode: its double-mounted effects would open every preview connection twice.
createRoot(document.getElementById("root")!).render(<App />);
