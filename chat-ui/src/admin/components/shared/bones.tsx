/**
 * Skeletons measured from the real UI.
 *
 * Hand-written skeletons drift: `PageSkeleton` rendered three cards and one
 * block for every page in the dashboard, so what flashed during load rarely
 * resembled what arrived. Boneyard snapshots the actual rendered DOM at build
 * time (`npm run bones`) and replays those measurements, so the placeholder
 * matches the page it stands in for.
 *
 * Wrap a page's *loaded* content -- the capture pass renders the children and
 * measures them, so an early `if (loading) return <Skeleton/>` would give it
 * nothing to measure.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Skeleton as BoneSkeleton, configureBoneyard } from "boneyard-js/react";

import { PageSkeleton } from "./loading-skeleton";
import { readTheme, THEME_HTML_ATTR, THEME_ROOT_ID, type Theme } from "@/admin/hooks/use-theme";
// Registering here rather than in the app entry means the bones cannot be
// loaded without the component that needs them, or forgotten in a new entry.
import "@/admin/bones/registry";

import dashboard from "@/admin/bones/dashboard.bones.json";
import dashboardSide from "@/admin/bones/dashboard-side.bones.json";
import stats from "@/admin/bones/stats.bones.json";
import conversionsAgenda from "@/admin/bones/conversions-agenda.bones.json";
import contentDocuments from "@/admin/bones/content-documents.bones.json";
import helpdeskList from "@/admin/bones/helpdesk-list.bones.json";
import conversionsList from "@/admin/bones/conversions-list.bones.json";
import toolsAppointments from "@/admin/bones/tools-appointments.bones.json";
import toolsLeads from "@/admin/bones/tools-leads.bones.json";
import toolsEscalations from "@/admin/bones/tools-escalations.bones.json";
import toolsProducts from "@/admin/bones/tools-products.bones.json";

/**
 * Bone colours, because boneyard cannot work out which theme is on.
 *
 * It decides light vs dark by looking for a `.dark` class on <html> or on an
 * ancestor of the skeleton. This app themes with `data-theme` on its own root
 * and deliberately avoids that class: tailwind.config.ts sets
 * `darkMode: ["class"]`, so a stray `.dark` would switch on every `dark:`
 * utility in the admin at once. Boneyard therefore always took its light
 * branch and drew near-white bones over a dark page.
 *
 * The fix is not to pick the branch but to remove the choice: resolve the
 * theme here and give both branches the same value, so whichever one boneyard
 * takes is correct. Values track the admin's muted/border tokens.
 */
const PALETTE: Record<Theme, { bone: string; shimmer: string }> = {
  dark: { bone: "#242424", shimmer: "#2e2e2e" },
  light: { bone: "#e4e4e7", shimmer: "#f4f4f5" },
};

configureBoneyard({ speed: "1.6s" });

/**
 * Point boneyard's shimmer highlight at a theme.
 *
 * Unlike the bone colour this is global config, not a prop, and boneyard reads
 * it while rendering. Anything that applies it later -- an effect, a committed
 * state value -- lands a render late, and a toggle repainted the bones in the
 * new theme while the streak crossing them stayed in the old one: a dark stripe
 * over light bones. It is also genuinely global, so tracking it per instance
 * goes stale the moment a skeleton mounts after a toggle it did not witness.
 *
 * Hence a module-level write, called during render. It is a pure function of
 * the theme, so a repeated or discarded render writes the same value.
 */
let configuredShimmer = "";
function applyShimmer(theme: Theme): void {
  const { shimmer } = PALETTE[theme];
  if (configuredShimmer === shimmer) return;
  configuredShimmer = shimmer;
  // Both keys: whichever branch boneyard's dark detection takes, it is right.
  configureBoneyard({ shimmerColor: shimmer, darkShimmerColor: shimmer });
}

// Seed from the theme already decided at import time -- readTheme falls back to
// the stored choice before React has stamped the attribute -- so the first
// skeleton paints in the right tone rather than correcting itself a frame later.
applyShimmer(readTheme());

/**
 * The live theme. The toggle lives in the header and shares no state with us,
 * so watch the attribute it writes rather than duplicating its state.
 */
function useAdminTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const sync = () => setTheme(readTheme());
    // The root only exists once React has mounted, which is after this module
    // was imported -- so re-read now rather than trusting the initial value.
    sync();
    const observer = new MutationObserver(sync);
    const root = document.getElementById(THEME_ROOT_ID);
    if (root) {
      observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    }
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [THEME_HTML_ATTR],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

type BonesFile = { breakpoints: Record<string, { height?: number }> };

/**
 * Captured height per skeleton, keyed by breakpoint.
 *
 * Boneyard scales bones to whatever box the container ends up with and does
 * not derive a height of its own. While loading, that box is wrong in both
 * directions: withhold the children and it collapses to 0; leave them in and
 * a list renders its *empty* state -- empty precisely because it is still
 * loading -- so an 870px list was drawn as a squashed 248px stand-in. Pinning
 * the captured height is what makes the placeholder the size of the real page.
 */
const CAPTURED: Record<string, BonesFile> = {
  dashboard,
  "dashboard-side": dashboardSide,
  stats,
  "content-documents": contentDocuments,
  "helpdesk-list": helpdeskList,
  "conversions-list": conversionsList,
  "conversions-agenda": conversionsAgenda,
  "tools-appointments": toolsAppointments,
  "tools-leads": toolsLeads,
  "tools-escalations": toolsEscalations,
  "tools-products": toolsProducts,
};

/** Captured height for `name` at the widest breakpoint the viewport clears. */
function capturedHeight(name: string, viewport: number): number | undefined {
  const file = CAPTURED[name];
  if (!file?.breakpoints) return undefined;
  const widths = Object.keys(file.breakpoints)
    .map(Number)
    .filter((w) => !Number.isNaN(w))
    .sort((a, b) => a - b);
  if (!widths.length) return undefined;
  // Same rule the runtime uses to pick bones: largest breakpoint <= viewport,
  // falling back to the smallest so narrow windows still get a height.
  const chosen = widths.filter((w) => w <= viewport).pop() ?? widths[0];
  return file.breakpoints[String(chosen)]?.height;
}

function useViewportWidth(active: boolean): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth
  );
  useEffect(() => {
    if (!active) return;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active]);
  return width;
}

interface BonesProps {
  /** Must match a name in src/admin/bones -- this is the registry key. */
  name: string;
  loading: boolean;
  children: ReactNode;
  /** Shown when no bones exist for this name yet (pre-capture, new page). */
  fallback?: ReactNode;
  className?: string;
}

export function Bones({ name, loading, children, fallback, className }: BonesProps) {
  const viewport = useViewportWidth(loading);
  const height = loading ? capturedHeight(name, viewport) : undefined;
  const theme = useAdminTheme();
  // Keeps the highlight in step with the bones below; see applyShimmer.
  applyShimmer(theme);
  const palette = PALETTE[theme];

  return (
    <BoneSkeleton
      name={name}
      loading={loading}
      // The admin is an app shell: the content column is far narrower than the
      // window, so container-width selection picks a breakpoint captured under
      // a different layout. Keying on the viewport matches how the CLI
      // captures. See boneyard-js#92.
      select="viewport"
      animate="shimmer"
      transition={200}
      // Both branches, same value: see PALETTE.
      color={palette.bone}
      darkColor={palette.bone}
      className={className}
      // Degrade to the old generic skeleton rather than a blank screen if a
      // capture is missing -- a forgotten `npm run bones` must not regress
      // the loading state to nothing.
      fallback={fallback ?? <PageSkeleton />}
    >
      {loading ? (
        <div style={height ? { height } : undefined} aria-hidden="true" />
      ) : (
        children
      )}
    </BoneSkeleton>
  );
}
