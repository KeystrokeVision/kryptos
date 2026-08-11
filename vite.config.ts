import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// KRYPTOS — Vite config tuned for Tauri v2
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Tauri expects a fixed port and will fail if it's occupied
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Ignore the Rust backend so file saves there don't trigger a web reload
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_PLATFORM == "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    // Split the heaviest, rarely-changing dependencies into their own
    // chunks so the browser/webview only needs to re-download them when
    // they actually change — not on every KRYPTOS code change. Monaco in
    // particular is inherently large (it's a full code editor engine);
    // the warning threshold is bumped to match instead of chasing an
    // unrealistic bundle size for that one chunk.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-monaco": ["monaco-editor", "@monaco-editor/react"],
          "vendor-xterm": ["xterm", "xterm-addon-fit", "xterm-addon-search", "xterm-addon-web-links"],
          "vendor-query": ["@tanstack/react-query"],
        },
      },
    },
  },
});
