import { defineConfig } from "vite";
import path from "path";
import { recordBundleContents } from "./build-tools/record-bundle-contents";
import { normalizeGeneratedAssets } from "./build-tools/normalize-generated-assets";

// The Protomaps renderer, loaded on demand by the chat bundle
// (src/lib/maps-runtime.ts). Built by `npm run build` after chat.js.
export default defineConfig({
  plugins: [
    recordBundleContents("chat-maps"),
    normalizeGeneratedAssets(path.resolve(__dirname, "../assets/js/chat-maps.js")),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    modulePreload: false,
    outDir: path.resolve(__dirname, "../assets"),
    emptyOutDir: false,
    copyPublicDir: false,
    rolldownOptions: {
      transform: {
        define: { "import.meta": "{}" },
        // protomaps-leaflet reads a global `L`; point it at the Leaflet the
        // chat bundle hands over instead (src/maps-runtime/leaflet-ref.ts).
        inject: { L: [path.resolve(__dirname, "./src/maps-runtime/leaflet-ref.ts"), "L"] },
      },
      input: path.resolve(__dirname, "./src/maps-runtime/main.ts"),
      output: {
        format: "iife",
        name: "AlphaRecallMapsBundle",
        entryFileNames: "js/chat-maps.js",
      },
    },
  },
});
