import { useApp } from "@/admin/app-context";
import { useNav, NavLink } from "@/admin/lib/nav-context";
import { interpolate, named } from "@/admin/lib/i18n";
import { assistantName } from "@/admin/components/assistant/shared";
import type { NavLeaf, SectionId } from "@/admin/lib/nav";
import { cn } from "@/admin/lib/utils";
import { fadeAttrs, useCenterCurrent, useScrollEdges } from "@/admin/components/shared/scroll-row";

/** A leaf's label, with the assistant's name where the copy uses it ("Prova Sofia"). */
export function useLeafLabel(): (leaf: NavLeaf) => string {
  const { t, settings } = useApp();
  const botName = String((settings.tenant_settings as Record<string, unknown> | undefined)?.chatbot_name || "").trim();
  return (leaf) =>
    leaf.id === "assistente/prova" && botName
      ? interpolate(t("nav.leaves.assistente.provaNamed"), { name: botName })
      : t(leaf.labelKey);
}

/** A leaf's one-line description, naming the assistant where the copy has a Named variant. */
export function useLeafDescription(): (leaf: NavLeaf) => string {
  const { t, settings } = useApp();
  const botName = assistantName(settings, "");
  return (leaf) => {
    const namedKey = `${leaf.descriptionKey}Named`;
    return botName && t(namedKey) !== namedKey ? named(t, leaf.descriptionKey, botName) : t(leaf.descriptionKey);
  };
}

/**
 * A section's pages (x-sub). A column on the left of the panel; on a narrow
 * frame the same links become a horizontally scrolling pill row (frame.css)
 * that fades where pages are cut off and keeps the open one in view.
 * Counts come from useNavBadge.
 *
 * The section name above the list is a label, not a heading: as an H2 it came
 * before the page's own H1 and broke the heading order of every page.
 */
export function SubNav({ section, className }: { section: SectionId; className?: string }) {
  const { t } = useApp();
  const { listedLeaves, route, badges, section: info } = useNav();
  const label = useLeafLabel();
  const { ref: listRef, el: list, edges } = useScrollEdges<HTMLUListElement>();
  const leaves = listedLeaves(section);

  useCenterCurrent(list, `${route.section}/${route.view}`);

  if (leaves.length < 2) return null;
  const sectionLabel = t(info.id === section ? info.labelKey : `nav.sections.${section}`);

  return (
    <nav className={cn("ar-sub", className)} aria-label={interpolate(t("nav.shell.subnavLabel"), { section: sectionLabel })}>
      <div className="ar-sub-title">{sectionLabel}</div>
      <ul ref={listRef} className="ar-sub-list scrollbar-none" {...fadeAttrs(edges)}>
        {leaves.map((leaf) => {
          const Icon = leaf.icon;
          const on = route.section === section && route.view === leaf.key;
          const badge = badges[leaf.id];
          return (
            <li key={leaf.id} className={leaf.gapBefore ? "ar-sub-gap" : undefined}>
              <NavLink to={leaf.id} aria-current={on ? "page" : undefined} data-tour={leaf.anchor} className="ar-sub-item">
                <Icon aria-hidden="true" />
                <span className="ar-sub-label">{label(leaf)}</span>
                {badge !== undefined && <em>{badge}</em>}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
