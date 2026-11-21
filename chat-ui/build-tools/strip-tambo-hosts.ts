import type { Plugin } from "vite";

/**
 * The bundled Tambo SDK client (@tambo-ai/typescript-sdk) carries Tambo's
 * hosted API as its default base URLs. The widget never uses that client
 * (src/runtime.tsx renders through TamboStubProvider and talks only to this
 * plugin's REST routes), so the hosts are dead code, but a reviewer reading
 * assets/js/chat.js cannot know that. They are replaced with an empty string
 * at build time, and the build fails if either one is still in the output.
 */
export const TAMBO_HOSTS = ["https://api.tambo.co", "https://hydra-api-dev.up.railway.app"] as const;

const SDK_MODULE = /[\\/]@tambo-ai[\\/]/;

export function stripTamboHosts(source: string): string {
  let out = source;
  for (const host of TAMBO_HOSTS) {
    // String literals become empty strings; any other mention (doc comments) goes too.
    out = out.split(`'${host}'`).join("''").split(`"${host}"`).join('""').split(`\`${host}\``).join("``");
    out = out.split(host).join("");
  }
  return out;
}

export function stripTamboHostsPlugin(): Plugin {
  return {
    name: "alpharecall-strip-tambo-hosts",
    enforce: "pre",
    transform(code, id) {
      if (!SDK_MODULE.test(id) || !TAMBO_HOSTS.some((host) => code.includes(host))) return null;
      return { code: stripTamboHosts(code), map: null };
    },
    generateBundle(_options, bundle) {
      for (const [file, output] of Object.entries(bundle)) {
        const text = output.type === "chunk" ? output.code : typeof output.source === "string" ? output.source : "";
        const left = TAMBO_HOSTS.filter((host) => text.includes(host.replace("https://", "")));
        if (left.length) this.error(`${file} still contains ${left.join(", ")}`);
      }
    },
  };
}
