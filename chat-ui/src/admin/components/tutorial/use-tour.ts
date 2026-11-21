/**
 * use-tour.ts
 * React hook running the AlphaRecall per-section admin tours on the in-house
 * tour engine (tour-engine.ts; intro.js was dropped for its AGPL licence).
 *
 * Features:
 * - One short tour per admin section (see tour-steps.ts)
 * - Filters steps to elements actually present in the DOM
 * - Localizes button labels (Avanti / Indietro / Salta / Fatto)
 * - Theme-aware tooltip styling (light / dark, AA contrast)
 * - ESC + visible Skip always exit
 * - onComplete / onSkip callbacks receive the section that ran
 */

import { useCallback, useEffect, useRef } from "react";
import { TARGET_CLASS, TourEngine, type TourEngineStep } from "./tour-engine";
import { SECTION_TOURS, type TourSection } from "./tour-steps";

interface UseTourOptions {
  t: (key: string) => string;
  theme: "light" | "dark" | "system";
  onComplete?: (section: TourSection) => void;
  onSkip?: (section: TourSection) => void;
}

function getElement(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * True when the element is actually rendered (not display:none / zero-size),
 * so tours never spotlight invisible anchors (e.g. the conversations detail
 * pane hidden on mobile).
 */
export function isElementVisible(el: Element | null): el is Element {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isDark(theme: string): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const STYLE_ID = "ar-tour-theme";

/** Base layout of the tour plus the light / dark palette (AA contrast on both). */
function tourCss(dark: boolean): string {
  const palette = dark
    ? {
        surface: "#131313", ink: "#ebebeb", text: "#c4c4c4", shade: "rgba(0,0,0,0.7)",
        shadow: "0 8px 32px rgba(0,0,0,0.6)", accent: "#2a6356", accentHover: "#34806e",
        prev: "rgba(255,255,255,0.06)", prevHover: "rgba(255,255,255,0.1)", prevInk: "#c4c4c4",
        skip: "#8a8a8a", skipHover: "#c4c4c4", track: "rgba(255,255,255,0.12)",
      }
    : {
        surface: "#ffffff", ink: "#171717", text: "#3d3d3d", shade: "rgba(0,0,0,0.45)",
        shadow: "0 6px 24px rgba(0,0,0,0.12)", accent: "#2d6e5d", accentHover: "#357a69",
        prev: "#f0f0f0", prevHover: "#e6e6e6", prevInk: "#555555",
        skip: "#6b6b6b", skipHover: "#3d3d3d", track: "#e6e6e6",
      };
  return `
    .ar-tour-overlay { position: fixed; inset: 0; z-index: 100000; pointer-events: none; }
    .ar-tour-blocker { position: fixed; pointer-events: auto; background: transparent; }
    .ar-tour-blocker.ar-tour-dim { background: ${palette.shade}; }
    .ar-tour-highlight { position: fixed; border-radius: 8px; pointer-events: none;
      box-shadow: ${palette.shade} 0 0 0 9999px; transition: top .2s ease, left .2s ease, width .2s ease, height .2s ease; }
    .ar-tour-tooltip { position: fixed; z-index: 100001; pointer-events: auto; box-sizing: border-box;
      width: min(320px, calc(100vw - 16px)); padding: 16px 16px 12px; border-radius: 10px;
      background: ${palette.surface}; color: ${palette.ink}; box-shadow: ${palette.shadow};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .ar-tour-title { margin: 0 0 4px; padding: 0; color: ${palette.ink}; font-size: 14px; font-weight: 600; line-height: 1.4; }
    .ar-tour-text { margin: 0 0 12px; color: ${palette.text}; font-size: 13px; line-height: 1.55; }
    .ar-tour-progress { height: 3px; margin: 0 0 12px; border-radius: 3px; background: ${palette.track}; overflow: hidden; }
    .ar-tour-progress > span { display: block; height: 100%; background: ${palette.accent}; transition: width .2s ease; }
    .ar-tour-buttons { display: flex; align-items: center; gap: 8px; }
    .ar-tour-button { border: none; border-radius: 7px; font: 500 12px/1.2 inherit; font-family: inherit; padding: 6px 14px; cursor: pointer; }
    .ar-tour-button:focus-visible { outline: 2px solid ${palette.accent}; outline-offset: 2px; }
    .ar-tour-skip { margin-right: auto; padding: 6px 0; background: transparent; color: ${palette.skip}; font-size: 11px; text-decoration: underline; }
    .ar-tour-skip:hover { color: ${palette.skipHover}; }
    .ar-tour-prev { background: ${palette.prev}; color: ${palette.prevInk}; }
    .ar-tour-prev:hover:not(:disabled) { background: ${palette.prevHover}; }
    .ar-tour-prev:disabled { opacity: .45; cursor: default; }
    .ar-tour-next { background: ${palette.accent}; color: #ffffff; }
    .ar-tour-next:hover { background: ${palette.accentHover}; }
    @media (prefers-reduced-motion: reduce) { .ar-tour-highlight, .ar-tour-progress > span { transition: none; } }
  `;
}

function injectThemeStyles(dark: boolean): void {
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = tourCss(dark);
}

function destroyThemeStyles(): void {
  const styleEl = document.getElementById(STYLE_ID);
  if (styleEl) styleEl.remove();
}

export function useTour({ t, theme, onComplete, onSkip }: UseTourOptions) {
  const introRef = useRef<TourEngine | null>(null);

  // Keep latest callbacks without re-creating startTour (avoids effect churn
  // in tutorial-manager when context callbacks change identity).
  const callbacksRef = useRef({ onComplete, onSkip });
  callbacksRef.current = { onComplete, onSkip };

  // Programmatic teardown (navigation/unmount) must NOT count as a user skip:
  // the engine fires onexit even on exit(true), and marking the section seen
  // there would permanently consume a tour the tenant never dismissed.
  const suppressExitCallbackRef = useRef(false);

  const buildSteps = useCallback(
    (section: TourSection) => {
      const filtered = (SECTION_TOURS[section] || []).filter(
        // Skip steps whose target element is absent or not visible
        (step) => isElementVisible(getElement(step.selector))
      );

      return filtered.map((step): TourEngineStep => ({
        element: step.selector,
        title: t(`tutorial.sections.${section}.${step.key}.title`),
        intro: t(`tutorial.sections.${section}.${step.key}.body`),
        position: step.position ?? "auto",
      }));
    },
    [t]
  );

  const exitTour = useCallback(() => {
    if (introRef.current) {
      suppressExitCallbackRef.current = true;
      try { introRef.current.exit(true); } catch { /* ignore */ }
      suppressExitCallbackRef.current = false;
      introRef.current = null;
    }
    destroyThemeStyles();
  }, []);

  /**
   * Start the tour for a section. Returns true when at least one step's
   * target exists and the tour actually started.
   */
  const startTour = useCallback(
    (section: TourSection): boolean => {
      // Tear down any existing instance
      exitTour();

      const steps = buildSteps(section);
      if (steps.length === 0) {
        return false;
      }

      injectThemeStyles(isDark(theme));

      // The admin shell scrolls an inner container, not the window: bring each
      // step's anchor into view ourselves, and only when it is actually out of view: re-centring an anchor that is
      // already on screen shifts the page under the highlight at every step.
      const scrollToStep = (el?: Element | null) => {
        if (!el) return;
        try {
          const r = el.getBoundingClientRect();
          const vh = window.innerHeight || document.documentElement.clientHeight;
          const visible = r.top >= 0 && r.bottom <= vh;
          if (!visible) el.scrollIntoView({ block: "center" });
        } catch { /* ignore */ }
      };
      scrollToStep(getElement(steps[0]?.element as string));

      const intro = new TourEngine({
        steps,
        labels: {
          next: t("tutorial.buttons.next"),
          prev: t("tutorial.buttons.prev"),
          skip: t("tutorial.buttons.skip"),
          done: t("tutorial.buttons.done"),
        },
        showProgress: true,
        exitOnOverlayClick: true,
        exitOnEsc: true,
        padding: 8,
      });
      introRef.current = intro;

      // Keep each step's anchor in view inside the inner scroll container.
      intro.onchange((el) => {
        scrollToStep(el as HTMLElement | undefined);
      });

      // Pages keep loading under the tour (a conversation list replaces its
      // spinner, polling swaps rows in), which moves the anchor while the tour
      // holds its old coordinates. Follow layout changes instead of drifting.
      let raf = 0;
      let lastRect = "";
      const follow = () => {
        if (introRef.current !== intro) return;
        window.cancelAnimationFrame(raf);
        raf = window.requestAnimationFrame(() => {
          // Polling rewrites rows constantly; only re-measure when the
          // highlighted anchor actually moved, otherwise the box jitters.
          const r = document.querySelector(`.${TARGET_CLASS}`)?.getBoundingClientRect();
          const key = r ? `${r.top}|${r.left}|${r.width}|${r.height}` : "";
          if (key === lastRect) return;
          lastRect = key;
          try { intro.refresh(); } catch { /* ignore */ }
        });
      };
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(follow) : null;
      const mo = new MutationObserver(follow);
      const appRoot = document.getElementById("alpharecall-admin-app") ?? document.body;
      mo.observe(appRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
      steps.forEach((s) => {
        const target = getElement(s.element as string);
        if (target && ro) ro.observe(target);
      });
      const scroller = appRoot.querySelector<HTMLElement>("[data-admin-ready]");
      scroller?.addEventListener("scroll", follow, { passive: true });
      const stopFollowing = () => {
        window.cancelAnimationFrame(raf);
        ro?.disconnect();
        mo.disconnect();
        scroller?.removeEventListener("scroll", follow);
      };

      // Track whether completion was a full finish vs skip/exit
      let completedFully = false;

      // oncomplete fires only when user clicks Done on the last step
      intro.oncomplete(() => {
        completedFully = true;
        stopFollowing();
        destroyThemeStyles();
        introRef.current = null;
        callbacksRef.current.onComplete?.(section);
      });

      // onexit fires on: ESC, overlay click, skip button — everything that isn't "Done".
      // It also fires on programmatic exit(true); the suppress flag keeps those
      // teardowns from being treated as a user skip.
      intro.onexit(() => {
        stopFollowing();
        destroyThemeStyles();
        introRef.current = null;
        if (!completedFully && !suppressExitCallbackRef.current) {
          callbacksRef.current.onSkip?.(section);
        }
      });

      intro.start();
      return true;
    },
    [buildSteps, theme, exitTour]
  );

  // Tear down any open tour when the owning component unmounts
  useEffect(() => exitTour, [exitTour]);

  return { startTour, exitTour };
}
