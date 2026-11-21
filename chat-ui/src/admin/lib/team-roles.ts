/** AlphaRecall team roles, most to least privileged (backend TenantMemberRole). */
export const TEAM_ROLE_ORDER = ["owner", "admin", "agent", "viewer"] as const;

export type RoleGroup<T> = { role: string; items: T[] };

/**
 * Buckets `items` by role.
 *
 * Every role in `order` gets a group even when nobody has it, so the caller can
 * show an empty state for it. Roles outside `order` follow in the order they
 * first appear, and items with no role ("") always come last.
 */
export function groupByRole<T>(
  items: readonly T[],
  roleOf: (item: T) => string | null | undefined,
  order: readonly string[] = [],
): RoleGroup<T>[] {
  const groups = new Map<string, T[]>(order.map((role) => [role, []]));
  for (const item of items) {
    const role = roleOf(item) || "";
    const bucket = groups.get(role);
    if (bucket) bucket.push(item);
    else groups.set(role, [item]);
  }
  const result = [...groups].map(([role, grouped]) => ({ role, items: grouped }));
  return [...result.filter((g) => g.role !== ""), ...result.filter((g) => g.role === "")];
}
