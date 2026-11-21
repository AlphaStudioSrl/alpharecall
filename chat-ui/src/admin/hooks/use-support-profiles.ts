import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/admin/lib/api";
import { ApiRequestError } from "@/admin/lib/rate-limit";

/** The API's 403 code when the plan's operator profile limit is reached (app/main.py). */
export const PROFILE_LIMIT_CODE = "support_profile_limit";

export function isProfileLimitError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 403 && error.code === PROFILE_LIMIT_CODE;
}

/**
 * The plan's operator profile limit, as the service states it (app/plans.py):
 * a number, null for no limit, undefined while unknown (loading, or an API
 * without the endpoint). The plugin keeps no table of its own; the service
 * refuses the profile above the limit either way.
 */
export function useSupportProfileLimit() {
  const [limit, setLimit] = useState<number | null | undefined>(undefined);
  const reload = useCallback(async () => {
    try {
      const data = await apiFetch<{ limit?: number | null }>("/support-profiles/limit", { cache: "reload" });
      const value = data?.limit;
      setLimit(typeof value === "number" && Number.isFinite(value) ? value : value === null ? null : undefined);
    } catch {
      setLimit(undefined);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { limit, reload };
}

export interface SupportProfile {
  id: number;
  name: string;
  avatar_url?: string;
  title?: string;
  is_default: boolean;
}

export function useSupportProfiles() {
  const [profiles, setProfiles] = useState<SupportProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<SupportProfile[] | { items?: SupportProfile[]; profiles?: SupportProfile[] }>(
        "/support-profiles"
      );
      let list: SupportProfile[];
      if (Array.isArray(data)) {
        list = data;
      } else {
        list = data?.items || data?.profiles || [];
      }
      setProfiles(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't load the support profiles.";
      setError(message);
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const add = useCallback(
    async (data: { name: string; avatar_url?: string; title?: string; is_default?: boolean }) => {
      setError(null);
      try {
        const profile = await apiFetch<SupportProfile>("/support-profiles", {
          method: "POST",
          body: JSON.stringify(data),
        });
        if (profile && profile.id) {
          setProfiles((prev) => {
            // If new profile is default, unset others
            if (profile.is_default) {
              return [...prev.map((p) => ({ ...p, is_default: false })), profile];
            }
            return [...prev, profile];
          });
        } else {
          await load();
        }
        return profile;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Couldn't add the profile.";
        setError(message);
        throw err;
      }
    },
    [load]
  );

  const update = useCallback(
    async (id: number, data: { name?: string; avatar_url?: string; title?: string; is_default?: boolean }) => {
      setError(null);
      try {
        const profile = await apiFetch<SupportProfile>(`/support-profiles/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        });
        if (profile && profile.id) {
          setProfiles((prev) =>
            prev.map((p) => {
              if (p.id === id) return profile;
              // If updated profile is now default, unset others
              if (profile.is_default) return { ...p, is_default: false };
              return p;
            })
          );
        }
        return profile;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Couldn't save the profile.";
        setError(message);
        throw err;
      }
    },
    []
  );

  const remove = useCallback(async (id: number) => {
    setError(null);
    try {
      await apiFetch(`/support-profiles/${id}`, { method: "DELETE" });
      setProfiles((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't delete the profile.";
      setError(message);
      throw err;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { profiles, loading, error, setError, load, add, update, remove };
}
