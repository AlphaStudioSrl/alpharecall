/**
 * What the widget's "Automatico" theme resolves to on the site, for the
 * widget editor's preview (card 1rvmurp2m29a).
 *
 * First choice: what the widget itself last saw on the site in this browser
 * (lib/host-theme rememberHostTheme; wp-admin shares the site's origin, so its
 * storage too). It reflects themes switched by script (alpharecall.com's toggle).
 * Otherwise the site's home is fetched once, its scripts, inline handlers and
 * nested frames are removed, and the rest is laid out in a hidden sandboxed
 * frame (no widget, no analytics, nothing runs) and read with the same
 * detection. The scripts are taken out rather than only blocked by the sandbox:
 * a blocked script logs a console error for every <script> on the page.
 * null when neither works: the caller keeps its previous behaviour.
 */
import { useEffect, useState } from "react";
import { detectHostTheme, readRememberedHostTheme, type ResolvedTheme } from "@/lib/host-theme";

/** A remembered theme older than this is checked against the site again. */
const REMEMBERED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10_000;

export function sameOrigin(url: string, base: string = typeof location !== "undefined" ? location.href : ""): boolean {
  try {
    return new URL(url, base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

/**
 * The site's page as inert HTML: no <script>, no module/script preload (a
 * blocked modulepreload logs too), no on* handler, no nested frame, no meta
 * refresh, and a <base> so its stylesheets and images still load.
 */
export function inertSiteHtml(html: string, siteUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll('script, iframe, frame, object, embed, meta[http-equiv], link[rel~="modulepreload"], link[as="script"]').forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  });
  const base = doc.createElement("base");
  base.href = new URL(siteUrl, typeof location !== "undefined" ? location.href : undefined).href;
  doc.head.prepend(base);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

/** Load `siteUrl` in a hidden frame (no scripts) and read its theme; null on failure or timeout. */
export function probeSiteTheme(siteUrl: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ResolvedTheme | null> {
  if (typeof document === "undefined" || !siteUrl || !sameOrigin(siteUrl)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    let done = false;
    const finish = (theme: ResolvedTheme | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      frame.remove();
      resolve(theme);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    // Same origin so it can be read, no allow-scripts so nothing on it runs
    // (and nothing is left to run: inertSiteHtml).
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.title = "";
    frame.style.cssText = "position:fixed;left:-20000px;top:0;width:1280px;height:800px;border:0;opacity:0;pointer-events:none;";
    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        // An empty frame has no body to read.
        if (!doc || !win || !doc.body || doc.URL === "about:blank") return finish(null);
        finish(detectHostTheme(doc, win));
      } catch {
        finish(null);
      }
    });
    frame.addEventListener("error", () => finish(null));
    fetch(siteUrl, { credentials: "same-origin", headers: { Accept: "text/html" } })
      .then((res) => (res.ok ? res.text() : null))
      .then((html) => {
        if (done) return;
        if (!html) return finish(null);
        frame.srcdoc = inertSiteHtml(html, siteUrl);
        document.body.appendChild(frame);
      })
      .catch(() => finish(null));
  });
}

const probeCache = new Map<string, Promise<ResolvedTheme | null>>();

/** The site's theme for the preview, or null while unknown. Probes at most once per page load. */
export function useSiteTheme(siteUrl: string | undefined, enabled: boolean): ResolvedTheme | null {
  const [theme, setTheme] = useState<ResolvedTheme | null>(() => {
    const remembered = readRememberedHostTheme();
    return remembered && Date.now() - remembered.at < REMEMBERED_MAX_AGE_MS ? remembered.theme : null;
  });
  useEffect(() => {
    if (!enabled || theme || !siteUrl) return;
    let alive = true;
    let pending = probeCache.get(siteUrl);
    if (!pending) {
      pending = probeSiteTheme(siteUrl);
      probeCache.set(siteUrl, pending);
    }
    void pending.then((found) => {
      if (alive && found) setTheme(found);
    });
    return () => {
      alive = false;
    };
  }, [enabled, siteUrl, theme]);
  return theme;
}

/** Tests only. */
export function resetSiteThemeProbe(): void {
  probeCache.clear();
}
