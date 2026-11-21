import { useLayoutEffect } from "react";

/** Size the app below the real WordPress chrome/notices, not just the toolbar. */
export function useAppViewport() {
  useLayoutEffect(() => {
    const root = document.getElementById("alpharecall-admin-app");
    if (!root) return;
    const measure = () => {
      let top = root.getBoundingClientRect().top;
      // Outer scroll containers must not make the app grow as they scroll.
      for (let parent = root.parentElement; parent; parent = parent.parentElement) top += parent.scrollTop;
      const height = `${Math.max(0, Math.floor((window.visualViewport?.height ?? window.innerHeight) - Math.max(0, top)))}px`;
      if (root.style.getPropertyValue("--ar-app-height") !== height) root.style.setProperty("--ar-app-height", height);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (root.parentElement) observer?.observe(root.parentElement);
    const toolbar = document.getElementById("wpadminbar");
    if (toolbar) observer?.observe(toolbar);
    const notices = new MutationObserver(measure);
    if (root.parentElement) notices.observe(root.parentElement, { childList: true });
    const wordpressContent = document.getElementById("wpbody-content");
    if (wordpressContent && wordpressContent !== root.parentElement) {
      observer?.observe(wordpressContent);
      notices.observe(wordpressContent, { childList: true });
    }
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      notices.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      root.style.removeProperty("--ar-app-height");
    };
  }, []);
}
