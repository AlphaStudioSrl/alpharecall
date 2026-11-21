import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useApp } from "../app-context";
import { apiFetch, saveSettings } from "../lib/api";
import { useUnsavedChanges } from "../lib/leave-guard";
import { useDebouncedCallback } from "use-debounce";

type ChatConfig = Record<string, unknown>;
type TenantSettings = Record<string, unknown>;
type BusinessProfile = Record<string, unknown>;

/** Where each autosaved endpoint stands: "pending" from the edit until its newest save answers. */
export type SaveStatus = Record<"chat" | "tenant", "idle" | "pending" | "failed">;

export interface UseSettingsOptions {
  /** No "saved" toast after a successful save, for pages that show their own save state. Failures still toast. */
  silent?: boolean;
  /**
   * A failed tenant autosave puts its fields back to what the server has and
   * says so, instead of keeping the edit for a later retry. For pages with no
   * save status of their own (Notifiche, Privacy): a switch whose save failed
   * must not stay on until the next reload (card o6zjpvqxb2zl).
   */
  revertOnFailure?: boolean;
}

export function useSettings(options: UseSettingsOptions = {}) {
  const { settings, updateSettings, t } = useApp();
  const silent = useRef(options.silent === true);
  silent.current = options.silent === true;
  const revertOnFailure = useRef(options.revertOnFailure === true);
  revertOnFailure.current = options.revertOnFailure === true;

  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `error` is shared and the next successful save of any endpoint clears it;
  // this keeps a failure until that endpoint itself saves.
  const [saveStatus, setSaveStatusState] = useState<SaveStatus>({ chat: "idle", tenant: "idle" });
  const saveStatusRef = useRef(saveStatus);
  const setSaveStatus = useCallback((endpoint: keyof SaveStatus, status: SaveStatus[keyof SaveStatus]) => {
    if (saveStatusRef.current[endpoint] === status) return;
    saveStatusRef.current = { ...saveStatusRef.current, [endpoint]: status };
    setSaveStatusState(saveStatusRef.current);
  }, []);

  // A failed save keeps the edit only in this tab: ask before leaving it.
  // A pending one finishes on its own unless the tab itself closes.
  useUnsavedChanges({
    unsaved: saveStatus.chat === "failed" || saveStatus.tenant === "failed",
    pending: saveStatus.chat === "pending" || saveStatus.tenant === "pending",
  });

  const settingsRef = useRef(settings);
  const chatRevision = useRef(0);
  const chatSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const tenantDraft = useRef<Partial<TenantSettings>>({});
  const failedTenantPatch = useRef<Partial<TenantSettings>>({});
  const tenantRevision = useRef(0);
  const tenantSaveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  // revertOnFailure: what the server had for each field edited since its last
  // confirmed save, and how many times each was edited (a newer edit of the
  // field decides for it, not the failure of an older save).
  const confirmedTenant = useRef<Record<string, unknown>>({});
  const tenantFieldEdits = useRef<Record<string, number>>({});
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const saveChatConfig = useCallback(
    (patch: Partial<ChatConfig>) => {
      const merged = { ...settingsRef.current.chat_config, ...patch };
      const revision = ++chatRevision.current;
      settingsRef.current = { ...settingsRef.current, chat_config: merged };
      updateSettings({ chat_config: merged });
      setSaving(true);
      setSaveStatus("chat", "pending");
      const save = async () => {
        setError(null);
        try {
          const result = await saveSettings("/settings", { chat_config: merged });
          // A server response must never replace edits made while it was pending.
          if (result && revision === chatRevision.current) {
            settingsRef.current = { ...settingsRef.current, chat_config: result.chat_config };
            updateSettings({ chat_config: result.chat_config });
          }
          setLastSaved("chat");
          if (revision === chatRevision.current) setSaveStatus("chat", "idle");
          if (revision === chatRevision.current && !silent.current) toast.success(t("toast.settingsSaved"));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Couldn't save your changes");
          // A newer save is queued and carries the whole config; it decides.
          if (revision === chatRevision.current) setSaveStatus("chat", "failed");
          toast.error(t("toast.settingsFailed"));
        } finally {
          if (revision === chatRevision.current) setSaving(false);
        }
      };
      chatSaveQueue.current = chatSaveQueue.current.then(save, save);
      return chatSaveQueue.current;
    },
    [updateSettings, t, setSaveStatus]
  );

  const debouncedSaveChatConfig = useDebouncedCallback(
    (patch: Partial<ChatConfig>) => saveChatConfig(patch),
    800
  );

  useEffect(() => () => { debouncedSaveChatConfig.flush(); }, [debouncedSaveChatConfig]);

  // Aspetto > Colore's picker (card qa3yfqhbam03): while it is open its
  // colors reach the preview at once but are saved once, when it closes. The
  // server adds every saved brand color to the history of recent colors, and
  // a pause while dragging or nudging with the arrows used to save (and so
  // remember) each shade passed through. "held": open, nothing changed yet;
  // "dirty": a change waits for the close.
  const chatHold = useRef<"off" | "held" | "dirty">("off");
  const holdChatSaves = useCallback(
    (on: boolean) => {
      if (on) {
        if (chatHold.current !== "off") return;
        // An edit made just before opening goes out now, with the old color.
        debouncedSaveChatConfig.flush();
        chatHold.current = "held";
        return;
      }
      const dirty = chatHold.current === "dirty";
      chatHold.current = "off";
      if (dirty) debouncedSaveChatConfig({});
    },
    [debouncedSaveChatConfig]
  );
  const saveHeldRef = useRef(saveChatConfig);
  saveHeldRef.current = saveChatConfig;
  // Leaving the page with the picker open still saves its color.
  useEffect(() => () => {
    if (chatHold.current !== "dirty") return;
    chatHold.current = "off";
    void saveHeldRef.current({});
  }, []);

  const saveTenantSettings = useCallback(
    (patch: Partial<TenantSettings>, successMessage?: string) => {
      const revision = ++tenantRevision.current;
      setSaving(true);
      setSaveStatus("tenant", "pending");
      // Counted now, not when the queue gets to it: an edit made while an
      // older save is in flight is newer than this save.
      const queuedEdits = Object.fromEntries(Object.keys(patch).map((key) => [key, tenantFieldEdits.current[key] ?? 0]));
      const save = async () => {
        const pendingPatch = { ...failedTenantPatch.current, ...patch };
        const merged = { ...settingsRef.current.tenant_settings, ...pendingPatch };
        const edits: Record<string, number> = {
          ...Object.fromEntries(Object.keys(pendingPatch).map((key) => [key, tenantFieldEdits.current[key] ?? 0])),
          ...queuedEdits,
        };
        const untouched = (key: string) => (tenantFieldEdits.current[key] ?? 0) === edits[key];
        setError(null);
        try {
          const result = await apiFetch<Record<string, unknown>>("/tenant-settings", {
            method: "POST",
            // The WP route accepts a patch: don't re-save unrelated settings
            // from an earlier tab while its request is still in flight.
            body: JSON.stringify(pendingPatch),
          });
          failedTenantPatch.current = {};
          for (const key of Object.keys(pendingPatch)) {
            // Edited again meanwhile: what the server holds now is this save's value.
            if (untouched(key)) delete confirmedTenant.current[key];
            else confirmedTenant.current[key] = pendingPatch[key];
          }
          // Reconcile chatbot_role / bot_role from server response
          const resolvedRole = String(
            result?.chatbot_role ?? result?.bot_role ??
            merged.chatbot_role ?? merged.bot_role ?? ""
          ).trim();
          const resolved = {
            ...merged,
            ...result,
            chatbot_role: resolvedRole,
            bot_role: resolvedRole,
          };
          if (revision === tenantRevision.current) {
            updateSettings({ tenant_settings: resolved });
            settingsRef.current = { ...settingsRef.current, tenant_settings: resolved };
          }
          setLastSaved("tenant");
          if (revision === tenantRevision.current) setSaveStatus("tenant", "idle");
          if (!silent.current || successMessage) toast.success(successMessage || t("toast.settingsSaved"));
          return true;
        } catch (e) {
          setError(e instanceof Error ? e.message : "Couldn't save your changes");
          if (revertOnFailure.current) {
            // Back to the server's value; a field edited again since rides on
            // its own, newer save.
            const back: Record<string, unknown> = {};
            for (const key of Object.keys(pendingPatch)) {
              if (!untouched(key) || !(key in confirmedTenant.current)) continue;
              back[key] = confirmedTenant.current[key];
              delete confirmedTenant.current[key];
            }
            if (Object.keys(back).length) {
              const reverted = { ...settingsRef.current.tenant_settings, ...back };
              settingsRef.current = { ...settingsRef.current, tenant_settings: reverted };
              updateSettings({ tenant_settings: reverted });
            }
            if (revision === tenantRevision.current) setSaveStatus("tenant", "idle");
            toast.error(t("toast.settingsReverted"), { duration: 8000 });
            return false;
          }
          // A later autosave must retry failed fields as well as the newest
          // edit; otherwise the full server response silently erases them.
          failedTenantPatch.current = pendingPatch;
          if (revision === tenantRevision.current) setSaveStatus("tenant", "failed");
          toast.error(t("toast.settingsFailed"));
          return false;
        } finally {
          if (revision === tenantRevision.current) setSaving(false);
        }
      };
      tenantSaveQueue.current = tenantSaveQueue.current.then(save, save);
      return tenantSaveQueue.current;
    },
    [updateSettings, t, setSaveStatus]
  );

  const debouncedSaveTenantSettings = useDebouncedCallback(
    (patch: Partial<TenantSettings>) => {
      const pending = { ...tenantDraft.current, ...patch };
      tenantDraft.current = {};
      return saveTenantSettings(pending);
    },
    800
  );

  // Navigating from Agent to Content must not discard a pending persona edit.
  useEffect(() => () => { debouncedSaveTenantSettings.flush(); }, [debouncedSaveTenantSettings]);

  const saveBusinessProfile = useCallback(
    async (patch: Partial<BusinessProfile>) => {
      const merged = { ...settingsRef.current.business_profile, ...patch };
      updateSettings({ business_profile: merged });
      setSaving(true);
      setError(null);
      try {
        await apiFetch("/business-profile", {
          method: "POST",
          body: JSON.stringify(merged),
        });
        setLastSaved("business");
        toast.success(t("toast.businessSaved"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your changes");
        toast.error(t("toast.settingsFailed"));
      } finally {
        setSaving(false);
      }
    },
    [updateSettings, t]
  );

  const saveTenantDomain = useCallback(
    async (domain: string) => {
      updateSettings({ tenant_domain: domain });
      setSaving(true);
      setError(null);
      try {
        const result = await saveSettings("/settings", {
          tenant_domain: domain,
        });
        if (result) updateSettings(result);
        setLastSaved("domain");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your changes");
      } finally {
        setSaving(false);
      }
    },
    [updateSettings]
  );

  const updateChatDraft = useCallback(
    (patch: Partial<ChatConfig>) => {
      ++chatRevision.current;
      const merged = { ...settingsRef.current.chat_config, ...patch };
      settingsRef.current = { ...settingsRef.current, chat_config: merged };
      setSaving(true);
      setSaveStatus("chat", "pending");
      updateSettings({ chat_config: merged });
      if (chatHold.current !== "off") {
        chatHold.current = "dirty";
        return;
      }
      debouncedSaveChatConfig(patch);
    },
    [updateSettings, debouncedSaveChatConfig, setSaveStatus]
  );

  const updateTenantDraft = useCallback(
    (patch: Partial<TenantSettings>) => {
      ++tenantRevision.current;
      for (const key of Object.keys(patch)) {
        if (!(key in confirmedTenant.current)) confirmedTenant.current[key] = settingsRef.current.tenant_settings?.[key];
        tenantFieldEdits.current[key] = (tenantFieldEdits.current[key] ?? 0) + 1;
      }
      tenantDraft.current = { ...tenantDraft.current, ...patch };
      const merged = { ...settingsRef.current.tenant_settings, ...patch };
      settingsRef.current = { ...settingsRef.current, tenant_settings: merged };
      setSaveStatus("tenant", "pending");
      updateSettings({ tenant_settings: merged });
      debouncedSaveTenantSettings(patch);
    },
    [updateSettings, debouncedSaveTenantSettings, setSaveStatus]
  );

  /**
   * Saves `patch` now and shows it only once the server has it: for a value
   * edited in place (Avanzate, the privacy notice) that must never look set
   * after a failed save. Throws on failure with the stored value untouched,
   * so the field stays open with the reason; no toast either way.
   */
  const commitTenantSettings = useCallback(
    (patch: Partial<TenantSettings>) => {
      const commit = async () => {
        const result = await apiFetch<Record<string, unknown>>("/tenant-settings", {
          method: "POST",
          body: JSON.stringify(patch),
        });
        // Only these fields: a full copy would overwrite edits still waiting in an autosave.
        const saved = Object.fromEntries(
          Object.keys(patch).map((key) => [key, result && key in result ? result[key] : patch[key]]),
        );
        const merged = { ...settingsRef.current.tenant_settings, ...saved };
        settingsRef.current = { ...settingsRef.current, tenant_settings: merged };
        updateSettings({ tenant_settings: merged });
      };
      // In line with the autosaves: an autosave answered after this commit
      // would otherwise put the old value back (here, and in WordPress's copy).
      const job = tenantSaveQueue.current.then(commit, commit);
      tenantSaveQueue.current = job.then(() => true, () => false);
      return job;
    },
    [updateSettings]
  );

  /** Saves again every endpoint whose newest save failed; the failed tenant fields ride along. */
  const retryFailedSaves = useCallback(async () => {
    const jobs: Promise<unknown>[] = [];
    if (saveStatusRef.current.chat === "failed") jobs.push(saveChatConfig({}));
    if (saveStatusRef.current.tenant === "failed") jobs.push(saveTenantSettings({}));
    await Promise.all(jobs);
  }, [saveChatConfig, saveTenantSettings]);

  return {
    saving,
    lastSaved,
    error,
    saveStatus,
    retryFailedSaves,
    saveChatConfig,
    saveTenantSettings,
    commitTenantSettings,
    saveBusinessProfile,
    saveTenantDomain,
    updateChatDraft,
    holdChatSaves,
    updateTenantDraft,
    debouncedSaveChatConfig,
    debouncedSaveTenantSettings,
  };
}
