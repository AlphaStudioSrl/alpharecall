import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/admin/lib/api";

export interface ReportShareStatus {
  active: boolean;
  url?: string;
  created_at?: string | null;
  expires_at?: string | null;
  expires_in_days?: 0 | 7 | 30 | 90;
  period_days?: number;
  language?: "it" | "en";
  client_name?: string;
  prepared_by?: string;
}

export interface CreateReportSharePayload {
  days: 7 | 30 | 90;
  expires_in_days: 0 | 7 | 30 | 90;
  language: "it" | "en";
  client_name: string;
  prepared_by: string;
}

export function useReportShare() {
  const [status, setStatus] = useState<ReportShareStatus>({ active: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await apiFetch<ReportShareStatus>("/report-share"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async (payload: CreateReportSharePayload) => {
    setSaving(true);
    setError(null);
    try {
      const next = await apiFetch<ReportShareStatus>("/report-share", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setStatus(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Try again.";
      setError(message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const revoke = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await apiFetch<ReportShareStatus>("/report-share", { method: "DELETE" });
      setStatus(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Try again.";
      setError(message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  return { status, loading, saving, error, create, revoke, refresh: load };
}
