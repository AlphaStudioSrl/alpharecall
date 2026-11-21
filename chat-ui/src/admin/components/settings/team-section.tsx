import { useState, useRef, useEffect, useCallback } from "react";

declare global {
  interface Window {
    wp?: {
      media?: (options: Record<string, unknown>) => {
        on: (event: string, callback: () => void) => void;
        open: () => void;
        state: () => {
          get: (key: string) => {
            first: () => {
              toJSON: () => { url: string };
            };
          };
        };
      };
    };
  }
}
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
import {
  Plus,
  AlertCircle,
  X,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  ImageOff,
} from "@/components/icons";
import {
  useSupportProfiles,
  useSupportProfileLimit,
  isProfileLimitError,
  type SupportProfile,
} from "@/admin/hooks/use-support-profiles";
import { apiFetch } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";
import { interpolate } from "@/admin/lib/i18n";
import { useNavIntent } from "@/admin/lib/nav-context";
import {
  PageHead,
  Avatar,
  AvatarStack,
  Group,
  Row,
  SelectPill,
  Tag,
  Toggle,
  IconButton,
} from "@/admin/components/shared/kit";
import { SupportTeamSection } from "./support-team-section";
import { LegacyAccessSection } from "./legacy-access-section";
import "./impostazioni.css";

type WpUser = { id: number; name: string; email: string; avatar_url: string; linked_profile_id: number };
/** Plan names as the customer knows them (license tier → product name). */
export function planLabel(t: (key: string) => string, tier: string | null | undefined): string {
  const key = String(tier || "").toLowerCase();
  return ["free", "pro", "business", "enterprise"].includes(key) ? t(`plans.${key}`) : key;
}

/* ─── WP Media Library helper ─── */

function openMediaLibrary(callback: (url: string) => void, labels: { title: string; button: string; unavailable: string }) {
  const frame = window.wp?.media?.({
    title: labels.title,
    multiple: false,
    library: { type: "image" },
    button: { text: labels.button },
  });

  if (!frame) {
    toast.error(labels.unavailable);
    return;
  }

  frame.on("select", () => {
    const attachment = frame.state().get("selection").first().toJSON();
    callback(attachment.url);
  });

  frame.open();
}

/* ─── Main component ─── */

export function TeamSection() {
  const { t, licenseTier, isAdmin } = useApp();
  const { profiles, loading, error, setError, add, update, remove } =
    useSupportProfiles();

  // The limit is the service's (GET /support-profiles/limit); unknown or null means none shown.
  const { limit: profileLimit, reload: reloadProfileLimit } = useSupportProfileLimit();
  const maxProfiles = typeof profileLimit === "number" ? profileLimit : Infinity;
  // Any plan: the API, not the plugin, keeps members out of Messaggi below Business.
  const canInvite = isAdmin;
  const canAddMore = profiles.length < maxProfiles;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [removeProfile, setRemoveProfile] = useState<SupportProfile | null>(null);
  const [removingProfile, setRemovingProfile] = useState(false);
  const [formName, setFormName] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formAvatar, setFormAvatar] = useState("");
  const [formDefault, setFormDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wpUsers, setWpUsers] = useState<WpUser[]>([]);
  const [formAssignedUserId, setFormAssignedUserId] = useState<number>(0);
  const [originalAssignedUserId, setOriginalAssignedUserId] = useState<number>(0);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Ctrl K "Invita un collega" lands here: it adds someone to the Team di supporto.
  useNavIntent("invite", () => {
    if (canInvite) setInviteOpen(true);
  });

  useEffect(() => {
    apiFetch<WpUser[]>("/wp-users")
      .then((users) => setWpUsers(Array.isArray(users) ? users : []))
      .catch(() => {});
  }, []);

  const openAddModal = useCallback(() => {
    setFormName("");
    setFormTitle("");
    setFormAvatar("");
    setFormDefault(profiles.length === 0); // Default first profile
    setFormAssignedUserId(0);
    setOriginalAssignedUserId(0);
    setEditId(null);
    setModalMode("add");
    setTimeout(() => nameInputRef.current?.focus(), 100);
  }, [profiles.length]);

  const openEditModal = useCallback((profile: SupportProfile) => {
    setFormName(profile.name);
    setFormTitle(profile.title || "");
    setFormAvatar(profile.avatar_url || "");
    setFormDefault(profile.is_default);
    const linkedUser = wpUsers.find((u) => u.linked_profile_id === profile.id);
    const linkedId = linkedUser?.id || 0;
    setFormAssignedUserId(linkedId);
    setOriginalAssignedUserId(linkedId);
    setEditId(profile.id);
    setModalMode("edit");
    setTimeout(() => nameInputRef.current?.focus(), 100);
  }, [wpUsers]);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
  }, []);

  const handleSave = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        avatar_url: formAvatar.trim() || undefined,
        title: formTitle.trim() || undefined,
        is_default: formDefault,
      };

      let savedId: number | null = null;
      if (modalMode === "edit" && editId != null) {
        await update(editId, payload);
        savedId = editId;
        toast.success(t("team.profileUpdated"));
      } else {
        const profile = await add(payload);
        savedId = profile?.id ?? null;
        toast.success(t("team.profileAdded"));
      }

      // Assign to WP user after successful save (only if changed)
      if (savedId && formAssignedUserId !== originalAssignedUserId) {
        try {
          await apiFetch(`/support-profiles/${savedId}/assign`, {
            method: "POST",
            body: JSON.stringify({ wp_user_id: formAssignedUserId }),
          });
          setWpUsers((prev) => prev.map((u) => ({
            ...u,
            linked_profile_id: u.id === formAssignedUserId ? savedId : (u.linked_profile_id === savedId ? 0 : u.linked_profile_id),
          })));
        } catch {
          // Non-critical, don't block the save
        }
      }

      closeModal();
    } catch (err) {
      // The hook keeps the API's message; the plan limit gets its own copy
      // and a fresh limit (the plan may have changed since the page loaded).
      if (isProfileLimitError(err)) {
        setError(t("team.profileLimitReached"));
        void reloadProfileLimit();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    // A second click while the DELETE is in flight would 404 and show an error
    // for a delete that worked.
    if (!removeProfile || removingProfile) return;
    setRemovingProfile(true);
    try {
      await remove(removeProfile.id);
      toast.success(t("team.profileDeleted"));
    } catch {
      // error is set in the hook
    } finally {
      setRemovingProfile(false);
      setRemoveProfile(null);
    }
  };

  const plan = planLabel(t, licenseTier);
  // Two different lists on this page: the Team di supporto (the one role that
  // opens Messaggi and Richieste; WordPress administrators get in without it)
  // and the operator profiles visitors see in the chat (/support-profiles, a
  // name and a photo, no access). The copy names each one so their counts
  // never read as a contradiction ("0 persone" next to "3 operatori").
  const subtitle = [
    memberCount !== null && isAdmin
      ? memberCount === 0 ? t("team.page.peopleNone") : interpolate(t(memberCount === 1 ? "team.page.personOne" : "team.page.people"), { n: memberCount })
      : null,
    interpolate(t("team.page.planLine"), { plan }),
  ].filter(Boolean).join(" · ");

  const profileSummary = profiles.length === 0
    ? t("team.page.profilesNone")
    : interpolate(t(profiles.length === 1 ? "team.page.profilesOne" : "team.page.profilesMany"), { n: profiles.length });

  return (
    <>
      <PageHead
        title={t("nav.leaves.impostazioni.team")}
        subtitle={subtitle}
        actions={canInvite ? (
          <Button onClick={() => setInviteOpen(true)} data-tour="settings-team-invite">
            <Plus className="size-4" />
            {t("team.page.invite")}
          </Button>
        ) : undefined}
      />

      {/* Error banner (profiles) */}
      {error && (
        <div className="ars-alert ars-alert-red" role="alert">
          <AlertCircle aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <IconButton icon={X} label={t("common.dismissError")} size="sm" onClick={() => setError(null)} />
        </div>
      )}

      {/* ─── Team di supporto: the only role this page grants ─── */}
      {isAdmin && <SupportTeamSection addOpen={inviteOpen} onAddOpenChange={setInviteOpen} onCountChange={setMemberCount} />}

      {/* Rules left by the old team panel: only shown while some exist */}
      <LegacyAccessSection />

      {/* ─── Operator profiles: how the team appears in the chat ─── */}
      <Group label={t("team.page.profilesGroup")}>
        <Row
          leading={profiles.length > 0 ? <AvatarStack people={profiles.map((p) => ({ name: p.name, src: p.avatar_url }))} max={4} /> : undefined}
          label={loading && profiles.length === 0 ? t("messages.loading") : profileSummary}
          description={t("team.page.profilesDesc")}
        >
          {profiles.length > 0 ? (
            <Button variant="secondary" aria-expanded={profilesOpen} aria-controls="ar-team-profiles" onClick={() => setProfilesOpen((v) => !v)}>
              {profilesOpen ? t("team.page.profilesClose") : t("team.page.profilesManage")}
            </Button>
          ) : (
            <Button variant="secondary" onClick={openAddModal} disabled={saving || !canAddMore}>
              <Plus className="size-4" />
              {t("team.addProfile")}
            </Button>
          )}
        </Row>
        {profilesOpen && profiles.length > 0 && (
          <div id="ar-team-profiles">
            <div className="ars-profiles">
              {profiles.map((profile) => {
                const assignedUser = wpUsers.find((u) => u.linked_profile_id === profile.id);
                return (
                  <div key={profile.id} className="ars-profile">
                    <Avatar name={profile.name} src={profile.avatar_url} size="l" />
                    <div className="ars-profile-text">
                      <b>
                        <span>{profile.name}</span>
                        {profile.is_default && <Tag>{t("team.default")}</Tag>}
                      </b>
                      {profile.title && <small>{profile.title}</small>}
                      {assignedUser && <small>{interpolate(t("team.page.linkedTo"), { name: assignedUser.name })}</small>}
                    </div>
                    <IconButton icon={Pencil} size="sm" label={`${t("team.editProfile")}: ${profile.name}`} onClick={() => openEditModal(profile)} />
                    <IconButton icon={Trash2} size="sm" label={`${t("buttons.delete")}: ${profile.name}`} onClick={() => setRemoveProfile(profile)} />
                  </div>
                );
              })}
            </div>
            <Row
              label={t("team.addProfile")}
              description={!canAddMore
                ? t("team.profileLimitReached")
                : maxProfiles !== Infinity
                ? interpolate(t("team.page.profilesLimit"), { n: profiles.length, max: maxProfiles })
                : undefined}
            >
              <Button variant="secondary" onClick={openAddModal} disabled={saving || !canAddMore}>
                <Plus className="size-4" />
                {t("team.page.add")}
              </Button>
            </Row>
          </div>
        )}
      </Group>

      {/* Delete profile confirm */}
      <Dialog open={removeProfile !== null} onOpenChange={(open) => { if (!open && !removingProfile) setRemoveProfile(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{removeProfile && interpolate(t("team.page.profileRemoveTitle"), { name: removeProfile.name })}</DialogTitle>
            <DialogDescription>{t("team.page.profileRemoveBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveProfile(null)} disabled={removingProfile}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => void handleRemove()} disabled={removingProfile} aria-busy={removingProfile}>
              {removingProfile && <Loader2 className="size-4 animate-spin" />}
              {t("buttons.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit profile */}
      <Dialog open={modalMode !== null} onOpenChange={(open) => { if (!open && !saving) closeModal(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{modalMode === "edit" ? t("team.editProfile") : t("team.addProfile")}</DialogTitle>
            <DialogDescription>
              {modalMode === "edit" ? t("team.editProfileDesc") : t("team.addProfileDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4">
            <Avatar name={formName || "?"} src={formAvatar.trim() || undefined} size="l" />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openMediaLibrary((url) => setFormAvatar(url), { title: t("team.chooseAvatar"), button: t("team.useAsAvatar"), unavailable: t("team.mediaUnavailable") })}
              >
                <Upload className="size-3.5" />
                {formAvatar.trim() ? t("team.changePhoto") : t("team.uploadPhoto")}
              </Button>
              {formAvatar.trim() && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setFormAvatar("")}>
                  <ImageOff className="size-3.5" />
                  {t("team.removePhoto")}
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ar-profile-name">{t("team.nameLabel")}</Label>
              <Input
                id="ar-profile-name"
                ref={nameInputRef}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t("team.namePlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ar-profile-title">{t("team.titleRoleLabel")}</Label>
              <Input
                id="ar-profile-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder={t("team.titlePlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("team.titleHint")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ar-profile-user">{t("team.assignToUser")}</Label>
              <SelectPill
                id="ar-profile-user"
                value={String(formAssignedUserId)}
                onValueChange={(value) => setFormAssignedUserId(Number(value))}
                options={[
                  { value: "0", label: t("team.unassigned") },
                  ...wpUsers.map((user) => ({ value: String(user.id), label: `${user.name} (${user.email})` })),
                ]}
                className="w-full justify-between"
              />
              <p className="text-xs text-muted-foreground">{t("team.assignToUserHint")}</p>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-group bg-fill px-3.5 py-3">
              <div>
                <label htmlFor="ar-profile-default" className="text-sm font-medium">{t("team.setAsDefault")}</label>
                <p className="text-xs text-muted-foreground">{t("team.setAsDefaultHint")}</p>
              </div>
              <Toggle id="ar-profile-default" checked={formDefault} onCheckedChange={setFormDefault} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closeModal} disabled={saving}>{t("common.cancel")}</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !formName.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving
                ? modalMode === "edit" ? t("common.saving") : t("common.adding")
                : modalMode === "edit" ? t("common.saveChanges") : t("team.addProfile")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
