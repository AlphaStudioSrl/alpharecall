import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Writes bundle-contents/<name>.json: for every script the build emits, the
 * files of this folder and the npm packages (version, licence, public source
 * repository) it was built from. It only reads the bundle, the output files
 * are the same with or without it. The readme's library list and
 * BUNDLE-SOURCES.md in the plugin package are made from these files.
 */

type PackageInfo = { name: string; version: string; license: string; repository: string };

const ROOT = path.resolve(__dirname, "..");
const MARKER = `${path.sep}node_modules${path.sep}`;

function repositoryUrl(manifest: { repository?: unknown; homepage?: unknown }): string {
  const repository = manifest.repository;
  let url = typeof repository === "string" ? repository : "";
  if (repository && typeof repository === "object" && "url" in repository) {
    url = String((repository as { url: unknown }).url ?? "");
  }
  url = url.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  url = url
    .replace(/^github:/, "https://github.com/")
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/#.*$/, "");
  if (!url && typeof manifest.homepage === "string") url = manifest.homepage;
  return url;
}

function packageOf(id: string, cache: Map<string, PackageInfo | null>): PackageInfo | null {
  const at = id.lastIndexOf(MARKER);
  if (at < 0) return null;
  const parts = id.slice(at + MARKER.length).split(path.sep);
  const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  const dir = path.join(id.slice(0, at + MARKER.length), ...name.split("/"));
  if (!cache.has(dir)) {
    const file = path.join(dir, "package.json");
    let info: PackageInfo | null = null;
    if (existsSync(file)) {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      info = {
        name,
        version: String(manifest.version ?? ""),
        license: typeof manifest.license === "string" ? manifest.license : "",
        repository: repositoryUrl(manifest),
      };
    }
    cache.set(dir, info);
  }
  return cache.get(dir) ?? null;
}

export function recordBundleContents(name: string): Plugin {
  return {
    name: "alpharecall-record-bundle-contents",
    apply: "build",
    async generateBundle(_options, bundle) {
      const cache = new Map<string, PackageInfo | null>();
      const packages = new Map<string, PackageInfo>();
      const files: Record<string, { sources: string[]; packages: string[] }> = {};
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        const sources = new Set<string>();
        const used = new Set<string>();
        for (const [rawId, module] of Object.entries(file.modules)) {
          if (module.renderedLength === 0) continue;
          const id = rawId.replace(/^\0+/, "").split("?")[0];
          if (!path.isAbsolute(id)) continue;
          const info = packageOf(id, cache);
          if (info) {
            const key = `${info.name}@${info.version}`;
            packages.set(key, info);
            used.add(key);
          } else if (id.startsWith(ROOT + path.sep)) {
            sources.add(path.relative(ROOT, id).split(path.sep).join("/"));
          }
        }
        files[file.fileName] = { sources: [...sources].sort(), packages: [...used].sort() };
      }
      const sortedFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
      const sortedPackages = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, info]) => info);
      const out = path.join(ROOT, "bundle-contents", `${name}.json`);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, `${JSON.stringify({ files: sortedFiles, packages: sortedPackages }, null, 2)}\n`, "utf8");
    },
  };
}
