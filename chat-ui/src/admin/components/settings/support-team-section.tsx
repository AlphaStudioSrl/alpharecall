import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, ArrowRight, Loader2, Plus, Trash2, Users } from "@/components/icons";
import { apiFetch, ApiRequestError } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";
import { interpolate } from "@/admin/lib/i18n";
import { useNavigate } from "@/admin/lib/nav-context";
import { supportTeamAvailable } from "@/admin/lib/support-team";
import { Avatar, Group, IconButton, SearchField, Segmented, Tag } from "@/admin/components/shared/kit";
import "./impostazioni.css";

/** A WordPress account as /support-team returns it (AlphaRecall_Support_Role::payload). */
export interface SupportTeamUser {
  id: number;
  name: string;
  email: string;
  avatar_url?: string;
  /** Their other WordPress roles, translated. */
  other_roles?: string[];
  /** WordPress administrators already see everything and never lose the role here. */
  is_site_admin?: boolean;
  is_self?: boolean;
}

/** Whether this row offers "Rimuovi": never yourself, never a site administrator. */
export function canRemoveFromSupportTeam(user: SupportTeamUser): boolean {
  return !user.is_self && !user.is_site_admin;
}

const statusOf = (error: unknown) => (error instanceof ApiRequestError ? error.status : 0);

export { supportTeamAvailable } from "@/admin/lib/support-team";

/**
 * Below Business: a note above the team (not a lock). Members can be added
 * now; Messaggi and Richieste open for them when the site moves to Business.
 */
export function SupportTeamPlanNote() {
  const { t, refreshLicenseTier } = useApp();
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <div className="ars-upsell" data-testid="support-team-plan-note">
      <div>
        <b className="flex items-center gap-2">
          <Users className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
          {t("supportTeam.lockedTitle")}
        </b>
        <p>{t("supportTeam.lockedBody")}</p>
        <p>{t("supportTeam.lockedKept")}</p>
      </div>
      {/* A span: `.ars-upsell > div` would stretch the actions to half the row. */}
      <span className="flex flex-col items-start gap-1">
        <Button onClick={() => navigate("impostazioni/piano")}>
          {t("supportTeam.lockedCta")}
          <ArrowRight className="size-4" />
        </Button>
        {refreshLicenseTier && (
          <Button
            variant="ghost"
            size="sm"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                await refreshLicenseTier();
              } finally {
                setRefreshing(false);
              }
            }}
          >
            {refreshing && <Loader2 className="size-3 animate-spin" />}
            {t("supportTeam.lockedRefresh")}
          </Button>
        )}
      </span>
    </div>
  );
}

/**
 * Team di supporto: the people holding the "Supporto AlphaRecall" role. They
 * answer chats (Messaggi) and handle requests (Richieste) and see nothing
 * else. An admin adds an existing WordPress account or creates one by e-mail
 * (WordPress sends the link to choose a password) and can take the role away.
 * This is the only role the screen grants.
 */
export interface SupportTeamSectionProps {
  /** The page's "Invita" button and the Ctrl K intent open the add dialog. */
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
  /** Reports how many people are on the team, for the page subtitle. */
  onCountChange?: (count: number) => void;
}

export function SupportTeamSection({ addOpen: addOpenProp, onAddOpenChange, onCountChange }: SupportTeamSectionProps = {}) {
  const { t, licenseTier } = useApp();
  const tierAllows = supportTeamAvailable(licenseTier);
  const [members, setMembers] = useState<SupportTeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [addOpenState, setAddOpenState] = useState(false);
  const addOpen = addOpenProp ?? addOpenState;
  const setAddOpen = useCallback((open: boolean) => {
    setAddOpenState(open);
    onAddOpenChange?.(open);
  }, [onAddOpenChange]);
  const [removeTarget, setRemoveTarget] = useState<SupportTeamUser | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    apiFetch<{ members?: SupportTeamUser[] }>("/support-team", { cache: "reload" })
      .then((res) => setMembers(Array.isArray(res?.members) ? res.members : []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!loading && !loadError) onCountChange?.(members.length);
  }, [members.length, loading, loadError, onCountChange]);

  const added = useCallback((user: SupportTeamUser) => {
    setMembers((prev) => (prev.some((m) => m.id === user.id) ? prev : [...prev, user].sort((a, b) => a.name.localeCompare(b.name))));
  }, []);

  const remove = async () => {
    if (!removeTarget || removing) return;
    setRemoving(true);
    try {
      await apiFetch(`/support-team/${removeTarget.id}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.id !== removeTarget.id));
      toast.success(interpolate(t("supportTeam.removed"), { name: removeTarget.name }));
      setRemoveTarget(null);
    } catch {
      toast.error(t("supportTeam.removeFailed"));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Group
      label={t("supportTeam.title")}
      action={
        // Inside Team e accessi the page's "Invita" is the add button.
        onAddOpenChange ? undefined : (
          <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)} data-testid="support-team-add">
            <Plus className="size-4" />
            {t("supportTeam.add")}
          </Button>
        )
      }
    >
      <p className="ars-role-empty" style={{ paddingTop: 10 }}>{t("supportTeam.description")}</p>
      {!tierAllows && <SupportTeamPlanNote />}
      {loading ? (
        <div className="ars-person" aria-busy="true">
          <span className="ars-skel" style={{ width: 32, height: 32, borderRadius: "50%" }} />
          <span className="ars-skel" style={{ height: 30, flex: 1, maxWidth: 260 }} />
        </div>
      ) : loadError ? (
        <div className="ars-alert" role="alert">
          <AlertCircle aria-hidden="true" />
          <div className="ars-alert-body">
            <span>{t("supportTeam.loadError")}</span>
            <div><Button variant="secondary" size="sm" onClick={load}>{t("billing.retry")}</Button></div>
          </div>
        </div>
      ) : members.length === 0 ? (
        <p className="ars-role-empty">{t("supportTeam.empty")}</p>
      ) : (
        <ul className="ars-people" aria-label={t("supportTeam.title")}>
          {members.map((member) => (
            <li key={member.id} className="ars-person">
              <Avatar name={member.name || member.email} src={member.avatar_url || undefined} />
              <div className="ars-person-text">
                <div className="ars-person-name">
                  <p>{member.name || member.email}</p>
                  {member.is_self && <span>{t("team.page.you")}</span>}
                </div>
                {member.email && member.email !== member.name && <span className="ars-person-mail">{member.email}</span>}
              </div>
              {member.is_site_admin ? (
                <Tag>{t("supportTeam.siteAdmin")}</Tag>
              ) : member.other_roles && member.other_roles.length > 0 ? (
                <span className="ars-person-meta" title={member.other_roles.join(", ")}>{member.other_roles.join(", ")}</span>
              ) : null}
              {canRemoveFromSupportTeam(member) ? (
                <IconButton
                  icon={Trash2}
                  size="sm"
                  label={interpolate(t("supportTeam.removeLabel"), { name: member.name || member.email })}
                  onClick={() => setRemoveTarget(member)}
                />
              ) : (
                <span style={{ width: 28 }} aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      )}

      <AddSupportMemberDialog open={addOpen} onOpenChange={setAddOpen} members={members} onAdded={added} />

      <Dialog open={removeTarget !== null} onOpenChange={(open) => { if (!open && !removing) setRemoveTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{removeTarget && interpolate(t("supportTeam.removeTitle"), { name: removeTarget.name || removeTarget.email })}</DialogTitle>
            <DialogDescription>{t("supportTeam.removeBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)} disabled={removing}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={removing} aria-busy={removing}>
              {removing && <Loader2 className="size-4 animate-spin" />}
              {t("supportTeam.removeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Group>
  );
}

type AddMode = "existing" | "new";

function AddSupportMemberDialog({
  open,
  onOpenChange,
  members,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: SupportTeamUser[];
  onAdded: (user: SupportTeamUser) => void;
}) {
  const { t } = useApp();
  const [mode, setMode] = useState<AddMode>("existing");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SupportTeamUser[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setMode("existing");
    setQuery("");
    setResults(null);
    setEmail("");
    setName("");
  }, [open]);

  // Search as the admin types (2+ characters), last request wins.
  useEffect(() => {
    const term = query.trim();
    if (!open || mode !== "existing" || term.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      apiFetch<{ users?: SupportTeamUser[] }>(`/support-team/search?q=${encodeURIComponent(term)}`, { cache: "reload" })
        .then((res) => { if (seq === searchSeq.current) setResults(Array.isArray(res?.users) ? res.users : []); })
        .catch(() => { if (seq === searchSeq.current) setResults([]); })
        .finally(() => { if (seq === searchSeq.current) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, open, mode]);

  const memberIds = new Set(members.map((m) => m.id));
  const candidates = (results || []).filter((u) => !memberIds.has(u.id));

  const addExisting = async (user: SupportTeamUser) => {
    setBusyId(user.id);
    try {
      const member = await apiFetch<SupportTeamUser>("/support-team", {
        method: "POST",
        body: JSON.stringify({ user_id: user.id }),
      });
      onAdded(member && member.id ? member : user);
      toast.success(interpolate(t("supportTeam.added"), { name: user.name || user.email }));
      onOpenChange(false);
    } catch (error) {
      const status = statusOf(error);
      toast.error(t(status === 409 ? "supportTeam.alreadyAdmin" : "supportTeam.addFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const createAccount = async () => {
    if (!email.trim() || creating) return;
    setCreating(true);
    try {
      const member = await apiFetch<SupportTeamUser>("/support-team/invite", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), name: name.trim() }),
      });
      if (member?.id) onAdded(member);
      toast.success(interpolate(t("supportTeam.invited"), { email: email.trim() }));
      onOpenChange(false);
    } catch (error) {
      const status = statusOf(error);
      if (status === 409) {
        // The address has an account: find it among the existing users instead.
        toast.error(t("supportTeam.emailExists"));
        setMode("existing");
        setQuery(email.trim());
      } else {
        // 403: on a network, no right to create accounts.
        toast.error(t(status === 422 ? "supportTeam.invalidEmail" : status === 403 ? "supportTeam.createForbidden" : "supportTeam.createFailed"));
      }
    } finally {
      setCreating(false);
    }
  };

  const term = query.trim();

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!creating && busyId === null) onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("supportTeam.addTitle")}</DialogTitle>
          <DialogDescription>{t("supportTeam.addDescription")}</DialogDescription>
        </DialogHeader>
        <Segmented<AddMode>
          value={mode}
          onValueChange={setMode}
          aria-label={t("supportTeam.addTitle")}
          options={[
            { value: "existing", label: t("supportTeam.modeExisting") },
            { value: "new", label: t("supportTeam.modeNew") },
          ]}
        />
        {mode === "existing" ? (
          <div className="grid gap-3">
            <SearchField
              value={query}
              onChange={setQuery}
              label={t("supportTeam.searchLabel")}
              placeholder={t("supportTeam.searchPlaceholder")}
              autoFocus
            />
            {term.length < 2 ? (
              <p className="text-xs text-muted-foreground">{t("supportTeam.searchHint")}</p>
            ) : searching && results === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("messages.loading")}</div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("supportTeam.noResults")}{" "}
                <button type="button" className="underline underline-offset-2" onClick={() => { setMode("new"); if (term.includes("@")) setEmail(term); }}>
                  {t("supportTeam.createInstead")}
                </button>
              </p>
            ) : (
              // The dialog is portaled out of the app root, where the ars-* list styles do not reach.
              <ul className="grid max-h-72 gap-1 overflow-y-auto" aria-label={t("supportTeam.searchResults")}>
                {candidates.map((user) => (
                  <li key={user.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                    <Avatar name={user.name || user.email} src={user.avatar_url || undefined} />
                    <div className="flex min-w-0 flex-1 flex-col leading-snug">
                      <p className="truncate text-sm font-medium">{user.name || user.email}</p>
                      {user.email && user.email !== user.name && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => void addExisting(user)} disabled={busyId !== null}>
                      {busyId === user.id && <Loader2 className="size-4 animate-spin" />}
                      {t("supportTeam.addOne")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => { event.preventDefault(); void createAccount(); }}
          >
            <div className="grid gap-2">
              <Label htmlFor="ar-support-email">{t("supportTeam.emailLabel")}</Label>
              <Input id="ar-support-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@esempio.it" autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ar-support-name">{t("supportTeam.nameLabel")}</Label>
              <Input id="ar-support-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("team.namePlaceholder")} autoComplete="off" />
              <p className="text-xs text-muted-foreground">{t("supportTeam.inviteHint")}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={creating || !email.trim()}>
                {creating && <Loader2 className="size-4 animate-spin" />}
                {t("supportTeam.createSubmit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
