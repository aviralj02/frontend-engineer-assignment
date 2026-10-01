import { defineConfig } from "vite";
import { resolve } from "node:path";

// The in-page agent: one dependency-free IIFE, written next to the pages so the
// pages server (:4001) serves it from the page's own origin.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/agent/index.ts"),
      formats: ["iife"],
      name: "FigrAgent",
      fileName: () => "agent.js",
    },
    outDir: resolve(import.meta.dirname, "../backend/pages"),
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
  },
});
