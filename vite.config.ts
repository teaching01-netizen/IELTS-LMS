import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createHash } from "crypto";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * Emits ielts-offline-assets.json: every immutable build asset plus the
 * navigation document, for public/ielts-offline-sw.js. Listing the whole
 * build is a superset of the student exam route graph, so no lazily loaded
 * exam chunk can be missing offline.
 * offcut: whole build, not the student subgraph; prune if the shell outgrows device quota.
 */
function ieltsOfflineShellManifest(): Plugin {
  return {
    name: "ielts-offline-shell-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((file) => !file.endsWith(".map") && !file.startsWith(".vite/") && file !== "index.html")
        .map((file) => `/${file}`)
        .sort();
      const buildId = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "ielts-offline-assets.json",
        source: JSON.stringify({ schemaVersion: 1, buildId, document: "/index.html", assets }),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const backendEnv = loadEnv(mode, "./backend", "VITE_");
  const backendApiUrl =
    env["VITE_BACKEND_API_URL"] || backendEnv["VITE_BACKEND_API_URL"] || "http://127.0.0.1:4000";
  return {
    plugins: [react(), tailwindcss(), ieltsOfflineShellManifest()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
        "@app": path.resolve(__dirname, "./src/app"),
        "@components": path.resolve(__dirname, "./src/components"),
        "@services": path.resolve(__dirname, "./src/services"),
        "@admin": path.resolve(__dirname, "./src/features/admin"),
        "@builder": path.resolve(__dirname, "./src/features/builder"),
        "@proctor": path.resolve(__dirname, "./src/features/proctor"),
        "@student": path.resolve(__dirname, "./src/features/student"),
        "@shared": path.resolve(__dirname, "./src/shared"),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env["DISABLE_HMR"] !== "true",
      proxy: {
        "/api": {
          target: backendApiUrl,
          // Keep the browser-visible Host for backend same-origin CSRF validation.
          // Rewriting it to the proxy target makes frontend mutations fail origin checks.
          changeOrigin: false,
          ws: true,
        },
        "/v2": {
          target: backendApiUrl,
          changeOrigin: false,
        },
      },
    },
    build: {
      // Emits dist/.vite/manifest.json for the student provider bundle
      // isolation gate (`bun run test:student-bundle`). Tiny JSON artifact;
      // the bundle-size analysis reads dist/index.html and is unaffected.
      manifest: true,
      rollupOptions: {
        output: {},
      },
      chunkSizeWarningLimit: 1000,
    },
  };
});
