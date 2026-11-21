import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { recordBundleContents } from "./build-tools/record-bundle-contents";
import { normalizeGeneratedAssets } from "./build-tools/normalize-generated-assets";
import { stripTamboHostsPlugin } from "./build-tools/strip-tambo-hosts";

// TODO: Consider lazy-loading admin-only deps (recharts, leaflet, @tiptap/*) via dynamic imports

export default defineConfig({
  // Font URLs must resolve inside the WordPress plugin, including subdirectory installs.
  base: "./",
  plugins: [
    stripTamboHostsPlugin(),
    react(),
    recordBundleContents("chat"),
    normalizeGeneratedAssets(
      path.resolve(__dirname, "../assets/js/chat.js"),
      path.resolve(__dirname, "../assets/css/chat.css")
    ),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss({ config: "./tailwind.config.ts" }), autoprefixer()],
    },
  },
  build: {
    modulePreload: false,
    outDir: path.resolve(__dirname, "../assets"),
    emptyOutDir: false,
    cssCodeSplit: false,
    rolldownOptions: {
      transform: {
        define: { "import.meta": "{}" },
      },
      input: path.resolve(__dirname, "./src/main.tsx"),
      output: {
        format: "iife",
        name: "AlphaRecallChatUI",
        entryFileNames: "js/chat.js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "css/chat.css";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
});
