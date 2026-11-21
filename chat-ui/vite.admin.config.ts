import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { rm } from "node:fs/promises";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { recordBundleContents } from "./build-tools/record-bundle-contents";
import { normalizeGeneratedAssets } from "./build-tools/normalize-generated-assets";
import { stripTamboHostsPlugin } from "./build-tools/strip-tambo-hosts";

/**
 * The admin is split by page (src/admin/app.tsx): the app and Oggi in one
 * chunk, every other page in its own, all ES modules with hashed names under
 * js/admin-chunks/, so a new build never reuses a name a browser cached.
 */
const CHUNK_DIR = "js/admin-chunks";

/**
 * outDir is shared with chat.js, so it is never emptied: clear the chunk
 * folder ourselves, or every build would leave its old chunks behind (and
 * in the plugin zip).
 */
function clearChunkDir(): Plugin {
  return {
    name: "alpharecall-clear-admin-chunks",
    apply: "build",
    async buildStart() {
      await rm(path.resolve(__dirname, "../assets", CHUNK_DIR), { recursive: true, force: true });
    },
  };
}

/**
 * js/admin.js, the file WordPress enqueues (AlphaRecall_Admin_UI, a classic script
 * with `?ver=`), is a loader written here: one dynamic import() of the app's
 * hashed entry chunk. Not the entry itself: chunks import shared code from
 * the entry, and they would name it without WordPress's `?ver=`, a second
 * URL and so a second copy of the app booting. The chunk URL is built from
 * `assetsUrl` (the plugin's assets URL, from PHP) so it holds even when an
 * optimizer serves admin.js from elsewhere; the script's own URL otherwise.
 */
function writeLoader(): Plugin {
  return {
    name: "alpharecall-admin-loader",
    apply: "build",
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((file) => file.type === "chunk" && file.isEntry);
      if (!entry) throw new Error("admin build: no entry chunk");
      const relative = entry.fileName.replace(/^js\//, "");
      const source = `(function () {
  var config = window.AlphaRecallAdmin;
  var script = document.currentScript;
  var base = config && config.assetsUrl ? config.assetsUrl.replace(/\\/?$/, "/") + "js/" : (script ? script.src : location.href);
  // The boot check AlphaRecall_Admin_UI prints after this script waits on it.
  var boot = window.__AlphaRecallAdminBoot = import(new URL(${JSON.stringify(relative)}, base).href);
  boot.catch(function (error) {
    console.error("[AlphaRecall] Admin failed to load", error);
  });
})();
`;
      this.emitFile({ type: "asset", fileName: "js/admin.js", source });
    },
  };
}

export default defineConfig({
  // Relative base: font/asset URLs in admin.css resolve from the css/ dir, and
  // the chunks import each other relative to their own URL.
  base: "./",
  plugins: [
    clearChunkDir(),
    stripTamboHostsPlugin(),
    react(),
    writeLoader(),
    recordBundleContents("admin"),
    normalizeGeneratedAssets(
      path.resolve(__dirname, "../assets/js/admin.js"),
      path.resolve(__dirname, "../assets/css/admin.css")
    ),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: "./tailwind.admin.config.ts" }),
        autoprefixer(),
      ],
    },
  },
  build: {
    modulePreload: false,
    outDir: path.resolve(__dirname, "../assets"),
    emptyOutDir: false,
    // One admin.css for every page, chunks included: WordPress enqueues it.
    cssCodeSplit: false,
    rolldownOptions: {
      input: path.resolve(__dirname, "./src/admin/main.tsx"),
      output: {
        // ES modules: an IIFE cannot be split into chunks.
        format: "es",
        entryFileNames: `${CHUNK_DIR}/app-[hash].js`,
        chunkFileNames: `${CHUNK_DIR}/[name]-[hash].js`,
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith(".css")) {
            return "css/admin.css";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
});
