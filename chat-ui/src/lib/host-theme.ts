/**
 * What the host page looks like right now, light or dark, for the widget's
 * "Automatico" theme (card 1rvmurp2m29a).
 *
 * Sites say it in many ways, so the signals are read from the most explicit:
 *  1. <html>/<body>: a marker class ("dark", "theme-light", "ar-light"...), a
 *     theme attribute (data-theme, data-bs-theme, data-color-scheme...), the
 *     `color-scheme` CSS property, then <meta name="color-scheme">.
 *  2. The page's own layers: the wrappers that cover the whole page (themes
 *     often paint and mark one: alpharecall.com toggles
 *     `.ar-site[data-ar-color-scheme]` and leaves <html>/<body> unpainted).
 *     A marker or attribute on one of them, then the luminance of the
 *     topmost opaque background among them, <body> and <html>.
 *  3. The visitor's OS preference (prefers-color-scheme).
 *
 * Everything takes the document and window, so the admin preview can run the
 * same detection on the site loaded in a hidden frame.
 */

export type ResolvedTheme = "light" | "dark";

const DARK_MARKER_RE =
  /(?:^|\s)(?:dark|dark-mode|darkmode|dark-theme|theme-dark|is-dark|ar-dark|wp-dark-mode-active|color-scheme-dark|scheme-dark|mode-dark)(?:\s|$)/i;
const LIGHT_MARKER_RE =
  /(?:^|\s)(?:light|light-mode|lightmode|light-theme|theme-light|is-light|ar-light|color-scheme-light|scheme-light|mode-light)(?:\s|$)/i;
/** data-theme, data-bs-theme, data-color-scheme, data-ar-color-scheme, data-mode, data-appearance... */
const THEME_ATTR_RE = /^data-(?:[a-z0-9]+-)*(?:theme|color-scheme|colour-scheme|scheme|color-mode|colour-mode|mode|appearance)$/i;
const THEME_VALUE_RE = /^(?:theme[-_]?)?(dark|light)(?:[-_]?(?:mode|theme))?$/i;

/** The element the widget renders into: never part of the host page. */
export const WIDGET_ROOT_ID = "alpharecall-chat-root";

/** Relative luminance where white and black text have the same contrast. */
const LUMINANCE_SPLIT = 0.179;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT", "SVG", "IFRAME"]);

export type Rgba = [number, number, number, number];

export const parseCssColor = (value: string): Rgba | null => {
  const m = String(value || "").trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map(Number);
  if (channels.some((n) => Number.isNaN(n))) return null;
  let alpha = 1;
  if (parts.length > 3) {
    const raw = parts[3];
    alpha = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    if (Number.isNaN(alpha)) alpha = 1;
  }
  return [channels[0], channels[1], channels[2], alpha];
};

/**
 * A computed colour as RGBA. Browsers keep a colour written as oklch(), lab()
 * or color() in that space, so anything that is not rgb() goes through a 1x1
 * canvas, which converts it to sRGB.
 */
const toRgba = (value: string, doc: Document): Rgba | null => {
  const direct = parseCssColor(value);
  if (direct) return direct;
  const text = String(value || "").trim();
  if (!text || text === "transparent" || text === "none") return null;
  try {
    const canvas = doc.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0, 0, 0, 0)";
    ctx.fillStyle = text;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    return [r, g, b, a / 255];
  } catch {
    return null;
  }
};

export const relativeLuminance = ([r, g, b]: Rgba): number => {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export const themeOfColor = (color: Rgba): ResolvedTheme => (relativeLuminance(color) < LUMINANCE_SPLIT ? "dark" : "light");

/** A marker class or a theme attribute on this element. */
export const markerTheme = (el: Element): ResolvedTheme | null => {
  const cls = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
  if (LIGHT_MARKER_RE.test(cls)) return "light";
  if (DARK_MARKER_RE.test(cls)) return "dark";
  for (const attr of Array.from(el.attributes)) {
    if (!THEME_ATTR_RE.test(attr.name)) continue;
    const m = attr.value.trim().match(THEME_VALUE_RE);
    if (m) return m[1].toLowerCase() as ResolvedTheme;
  }
  return null;
};

/** "dark" / "only light" decide; "light dark" (both offered) and "normal" do not. */
export const schemeTheme = (value: string | null | undefined): ResolvedTheme | null => {
  const tokens = String(value || "").toLowerCase().split(/[\s,]+/).filter((t) => t && t !== "only");
  const dark = tokens.includes("dark");
  const light = tokens.includes("light");
  if (dark === light) return null;
  return dark ? "dark" : "light";
};

const isPageElement = (el: Element) => !SKIP_TAGS.has(el.tagName.toUpperCase()) && el.id !== WIDGET_ROOT_ID;

/**
 * The wrappers that cover the whole page, outermost first: from <body>, the
 * in-flow child that spans (nearly) all of its parent, and so on. A header,
 * a hero band or a sidebar does not cover the page and stops the walk.
 */
export const pageLayers = (doc: Document, win: Window, maxDepth = 6): HTMLElement[] => {
  const layers: HTMLElement[] = [];
  let parent: HTMLElement | null = doc.body;
  const viewportW = win.innerWidth || doc.documentElement.clientWidth || 0;
  const viewportH = win.innerHeight || doc.documentElement.clientHeight || 0;
  for (let depth = 0; parent && depth < maxDepth; depth += 1) {
    const parentRect = parent.getBoundingClientRect();
    const parentW = Math.max(parentRect.width, 1);
    const parentH = Math.max(parentRect.height, 1);
    let best: HTMLElement | null = null;
    let bestArea = 0;
    for (const node of Array.from(parent.children)) {
      // The frame the admin preview reads has its own HTMLElement: no instanceof.
      const child = node as HTMLElement;
      if (typeof child.getBoundingClientRect !== "function" || !isPageElement(child)) continue;
      const style = win.getComputedStyle(child);
      if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed" || style.position === "absolute") continue;
      const rect = child.getBoundingClientRect();
      const coversWidth = rect.width >= parentW * 0.8 || (viewportW > 0 && rect.width >= viewportW * 0.6);
      const coversHeight = rect.height >= parentH * 0.8 || (viewportH > 0 && rect.height >= viewportH * 0.9);
      if (!coversWidth || !coversHeight) continue;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = child;
        bestArea = area;
      }
    }
    if (!best) break;
    layers.push(best);
    parent = best;
  }
  return layers;
};

const metaScheme = (doc: Document): ResolvedTheme | null => {
  const meta = doc.querySelector('meta[name="color-scheme" i]');
  return meta ? schemeTheme(meta.getAttribute("content")) : null;
};

const prefersDark = (win: Window): boolean => {
  try {
    return Boolean(win.matchMedia?.("(prefers-color-scheme: dark)").matches);
  } catch {
    return false;
  }
};

export type HostThemeSignal = "marker" | "color-scheme" | "meta" | "layer-marker" | "background" | "system";

/** The theme and which signal decided it (the reason helps tests and debugging). */
export const detectHostThemeWithReason = (
  doc: Document | undefined = typeof document !== "undefined" ? document : undefined,
  win: Window | undefined = typeof window !== "undefined" ? window : undefined
): { theme: ResolvedTheme; signal: HostThemeSignal } => {
  if (!doc || !win) return { theme: "light", signal: "system" };
  const roots = [doc.documentElement, doc.body].filter(Boolean) as HTMLElement[];
  for (const el of roots) {
    const theme = markerTheme(el);
    if (theme) return { theme, signal: "marker" };
  }
  for (const el of roots) {
    const theme = schemeTheme(win.getComputedStyle(el).colorScheme);
    if (theme) return { theme, signal: "color-scheme" };
  }
  const meta = metaScheme(doc);
  if (meta) return { theme: meta, signal: "meta" };

  const layers = doc.body ? pageLayers(doc, win) : [];
  for (const el of layers.slice().reverse()) {
    const theme = markerTheme(el) || schemeTheme(win.getComputedStyle(el).colorScheme);
    if (theme) return { theme, signal: "layer-marker" };
  }
  // The topmost painted layer is what the visitor sees behind the widget.
  for (const el of [...roots, ...layers].reverse()) {
    const color = toRgba(win.getComputedStyle(el).backgroundColor, doc);
    if (color && color[3] > 0.5) return { theme: themeOfColor(color), signal: "background" };
  }
  return { theme: prefersDark(win) ? "dark" : "light", signal: "system" };
};

export const detectHostTheme = (doc?: Document, win?: Window): ResolvedTheme => detectHostThemeWithReason(doc, win).theme;

/**
 * Re-run `onChange` whenever the host may have switched theme: a class, style
 * or data attribute on <html>, <body> or a page layer, a wrapper added to the
 * body, a <meta> or stylesheet added to <head>, the OS preference, the page
 * finishing loading. Runs once on the next frame and once more after CSS
 * transitions of the switch have settled. Returns the cleanup.
 */
export const watchHostTheme = (onChange: () => void, doc: Document = document, win: Window = window): (() => void) => {
  let frame = 0;
  let settle = 0;
  let lastRun = -Infinity;
  const refresh = () => {
    win.clearTimeout(settle);
    settle = win.setTimeout(() => {
      onChange();
      rewire();
    }, 450);
    // Some sites rewrite a CSS variable on <html> every scroll frame: read at
    // most every 200 ms then, the settle run above catches the final state.
    if (Date.now() - lastRun < 200) return;
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => {
      lastRun = Date.now();
      onChange();
      rewire();
    });
  };
  const Observer = (win as Window & typeof globalThis).MutationObserver ?? MutationObserver;
  const inWidget = (node: Node) => {
    const el = node as Element;
    return node.nodeType === 1 && (el.id === WIDGET_ROOT_ID || Boolean(el.closest?.(`#${WIDGET_ROOT_ID}`)));
  };
  const observer = new Observer((records) => {
    // The widget's own subtree (it sets data-theme on its root) is not the host.
    if (records.every((r) => inWidget(r.target))) return;
    refresh();
  });
  const rewire = () => {
    observer.disconnect();
    observer.observe(doc.documentElement, { attributes: true });
    if (doc.head) observer.observe(doc.head, { childList: true });
    if (doc.body) {
      observer.observe(doc.body, { attributes: true, childList: true });
      for (const layer of pageLayers(doc, win)) observer.observe(layer, { attributes: true });
    }
  };
  rewire();
  let media: MediaQueryList | null = null;
  try {
    media = win.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  } catch {
    media = null;
  }
  if (media?.addEventListener) media.addEventListener("change", refresh);
  else media?.addListener?.(refresh);
  win.addEventListener("load", refresh);
  win.addEventListener("pageshow", refresh);
  return () => {
    win.cancelAnimationFrame(frame);
    win.clearTimeout(settle);
    observer.disconnect();
    if (media?.removeEventListener) media.removeEventListener("change", refresh);
    else media?.removeListener?.(refresh);
    win.removeEventListener("load", refresh);
    win.removeEventListener("pageshow", refresh);
  };
};

/**
 * The widget leaves what it last saw on this site for the widget editor (same
 * origin as wp-admin), so its preview of "Automatico" matches the site in
 * this browser. Best effort: storage may be blocked.
 */
export const HOST_THEME_STORAGE_KEY = "alpharecall-host-theme";

export const rememberHostTheme = (theme: ResolvedTheme, storage?: Storage | null): void => {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!store) return;
    const previous = readRememberedHostTheme(store);
    if (previous && previous.theme === theme && Date.now() - previous.at < 60_000) return;
    store.setItem(HOST_THEME_STORAGE_KEY, JSON.stringify({ theme, at: Date.now() }));
  } catch {
    // Private mode or blocked storage: the editor falls back to probing the site.
  }
};

export const readRememberedHostTheme = (storage?: Storage | null): { theme: ResolvedTheme; at: number } | null => {
  try {
    const store = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    const raw = store?.getItem(HOST_THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { theme?: unknown; at?: unknown };
    if ((parsed.theme === "light" || parsed.theme === "dark") && typeof parsed.at === "number") {
      return { theme: parsed.theme, at: parsed.at };
    }
  } catch {
    // Unreadable: treat as never seen.
  }
  return null;
};
