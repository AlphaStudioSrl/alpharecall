/**
 * How the open page sits in the frame, and whether it brings its own title.
 *
 * Defaults come from the leaf (lib/nav.ts `frame`). A page that needs another
 * layout says so while it is mounted:
 *
 *   useFrameLayout({ panels: true });   // inbox: three panels on the canvas
 *   useFrameLayout({ flush: true });    // editor: no padding, page owns the edges
 *
 * The frame shows a default title (the leaf label and description) above
 * pages that have none. Rendering the kit's <PageHead> replaces it.
 */
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import type { FrameOptions } from "@/admin/lib/nav";

interface FrameContextValue {
  override: FrameOptions | null;
  setOverride: (value: FrameOptions | null) => void;
  ownHeads: number;
  addHead: (delta: number) => void;
}

const FrameContext = createContext<FrameContextValue | null>(null);

export function FrameProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverride] = useState<FrameOptions | null>(null);
  const [ownHeads, setOwnHeads] = useState(0);
  // Stable, so the registering effects below run once per mount.
  const addHead = useCallback((d: number) => setOwnHeads((n) => Math.max(0, n + d)), []);
  const value = useMemo<FrameContextValue>(
    () => ({ override, setOverride, ownHeads, addHead }),
    [override, ownHeads, addHead]
  );
  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
}

export function useFrame(): FrameContextValue | null {
  return useContext(FrameContext);
}

/**
 * Override the leaf's frame layout while the calling page is mounted.
 * Applied before paint, so the page never flashes in the wrong layout.
 */
export function useFrameLayout(options: FrameOptions): void {
  const setOverride = useContext(FrameContext)?.setOverride;
  const { fill, flush, panels } = options;
  useLayoutEffect(() => {
    if (!setOverride) return;
    setOverride({ fill, flush, panels });
    return () => setOverride(null);
  }, [fill, flush, panels, setOverride]);
}

/** Registers a page-supplied title so the frame drops its default one. */
export function useOwnPageHead(): void {
  const frame = useContext(FrameContext);
  const addHead = frame?.addHead;
  useLayoutEffect(() => {
    if (!addHead) return;
    addHead(1);
    return () => addHead(-1);
  }, [addHead]);
}
