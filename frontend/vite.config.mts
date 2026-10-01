import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Host app. The agent has its own config (vite.agent.config.ts) because it ships
// as a standalone IIFE served by the pages server, not as part of this bundle.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
