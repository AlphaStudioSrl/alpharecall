import { readFile, writeFile } from "node:fs/promises";
import type { Plugin } from "vite";


export function normalizeGeneratedText(source: string): string {
  return `${source
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/, "")}\n`;
}


export function normalizeGeneratedAssets(...assetPaths: string[]): Plugin {
  return {
    name: "alpharecall-normalize-generated-assets",
    async closeBundle() {
      for (const assetPath of assetPaths) {
        const source = await readFile(assetPath, "utf8");
        const normalized = normalizeGeneratedText(source);
        if (normalized !== source) {
          await writeFile(assetPath, normalized, "utf8");
        }
      }
    },
  };
}
