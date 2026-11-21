import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trash2 } from "@/components/icons";
import { apiFetch, ApiRequestError } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";
import { interpolate } from "@/admin/lib/i18n";
import { Avatar, Group, IconButton, Tag } from "@/admin/components/shared/kit";
import "./impostazioni.css";

/** A row of the old team panel (/team/members), as the API lists it. */
export interface LegacyAccessRow {
  id: number;
  wp_user_id: number;
  email: string;
  name?: string | null;
  role: "owner" | "admin" | "agent" | "viewer";
  status: string;
}

/** What the row does today, as an i18n key under legacyAccess.effect. */
export function legacyAccessEffect(row: Pick<LegacyAccessRow, "role" | "status">): string {
  if (row.status !== "active") return "suspended";
  return row.role;
}

/**
 * Rules left by the old team panel (Proprietari, Amministratori, Operatori,
 * Osservatori). The API still applies them on top of the WordPress roles: a
 * suspended row blocks a member of the Team di supporto, an "admin" row gives
 * a support member settings. That panel is gone, so this list is the only way
 * left to clear them; once a row is removed the person's access follows their
 * WordPress role alone. Shown to WordPress administrators, and only when such
 * rows exist (the list is plan-gated, so a failed load shows nothing).
 */
export function LegacyAccessSection() {
  const { t, isWpAdmin } = useApp();
  const [rows, setRows] = useState<LegacyAccessRow[]>([]);
  const [target, setTarget] = useState<LegacyAccessRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ members?: LegacyAccessRow[] }>("/team/members", { cache: "reload" })
      .then((res) => setRows(Array.isArray(res?.members) ? res.members : []))
      .catch(() => setRows([]));
  }, []);
  useEffect(() => {
    if (isWpAdmin) load();
  }, [isWpAdmin, load]);

  if (!isWpAdmin || rows.length === 0) return null;

  const remove = async () => {
    if (!target || removing) return;
    setRemoving(true);
    try {
      await apiFetch(`/team/members/${target.id}`, { method: "DELETE" });
      setRows((prev) => prev.filter((r) => r.id !== target.id));
      toast.success(interpolate(t("legacyAccess.removed"), { name: target.name || target.email }));
      setTarget(null);
    } catch (error) {
      const status = error instanceof ApiRequestError ? error.status : 0;
      toast.error(t(status === 400 ? "legacyAccess.lastOwner" : "legacyAccess.removeFailed"));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Group label={t("legacyAccess.title")}>
      <p className="ars-role-empty" style={{ paddingTop: 10 }}>{t("legacyAccess.description")}</p>
      <ul className="ars-people" aria-label={t("legacyAccess.title")}>
        {rows.map((row) => (
          <li key={row.id} className="ars-person" data-testid="legacy-access-row">
            <Avatar name={row.name || row.email} />
            <div className="ars-person-text">
              <div className="ars-person-name">
                <p>{row.name || row.email}</p>
              </div>
              {row.email && row.email !== row.name && <span className="ars-person-mail">{row.email}</span>}
            </div>
            <Tag tone={legacyAccessEffect(row) === "suspended" ? "red" : "warn"}>{t(`legacyAccess.effect.${legacyAccessEffect(row)}`)}</Tag>
            <IconButton
              icon={Trash2}
              size="sm"
              label={interpolate(t("legacyAccess.removeLabel"), { name: row.name || row.email })}
              onClick={() => setTarget(row)}
            />
          </li>
        ))}
      </ul>

      <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !removing) setTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{target && interpolate(t("legacyAccess.removeTitle"), { name: target.name || target.email })}</DialogTitle>
            <DialogDescription>{t("legacyAccess.removeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)} disabled={removing}>{t("common.cancel")}</Button>
            <Button onClick={() => void remove()} disabled={removing} aria-busy={removing}>
              {removing && <Loader2 className="size-4 animate-spin" />}
              {t("legacyAccess.removeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Group>
  );
}
