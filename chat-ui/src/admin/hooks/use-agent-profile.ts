import { useState, useEffect } from "react";
import { apiFetch } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";

export interface AgentProfile {
  id: number;
  name: string;
  avatar_url?: string;
  title?: string;
  is_default?: boolean;
}

/**
 * One lookup per page for the support user's own profile, shared by every
 * caller. Two mounts used to send two POST /me/support-profile at once on
 * the first load, and the second came back 409 ("creation in progress").
 * A failure is forgotten so the next mount asks again.
 */
let pending: Promise<AgentProfile | null> | null = null;

async function fetchOwnProfile(linkedProfileId: number): Promise<AgentProfile | null> {
  // Linked already: read it. GET answers 404 when nothing is linked, so a
  // first visit goes straight to POST, which also returns a profile that
  // is already linked instead of making a second one.
  if (linkedProfileId > 0) {
    try {
      const res = await apiFetch<AgentProfile>("/me/support-profile");
      if (res?.id) return res;
    } catch {
      // The link points at a deleted profile: POST makes a new one.
    }
  }
  const created = await apiFetch<AgentProfile>("/me/support-profile", { method: "POST" });
  return created?.id ? created : null;
}

export function loadOwnProfile(linkedProfileId: number): Promise<AgentProfile | null> {
  if (!pending) {
    const request = fetchOwnProfile(linkedProfileId).catch(() => null);
    pending = request;
    void request.then((profile) => {
      if (!profile && pending === request) pending = null;
    });
  }
  return pending;
}

/** Tests: start from a page that has not looked the profile up yet. */
export function resetOwnProfileCache(): void {
  pending = null;
}

export function useAgentProfile() {
  const { isAdmin, linkedProfileId, setLinkedProfileId } = useApp();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAdmin) return; // Admins use the manual profile selector
    let live = true;
    setLoading(true);
    // Silently fails to null: the agent can still reply, the proxy links a profile then.
    void loadOwnProfile(linkedProfileId).then((own) => {
      if (!live) return;
      setLoading(false);
      if (own) {
        setProfile(own);
        setLinkedProfileId(own.id);
      }
    });
    return () => { live = false; };
    // linkedProfileId is read once: the lookup itself sets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, setLinkedProfileId]);

  return { profile, loading };
}
