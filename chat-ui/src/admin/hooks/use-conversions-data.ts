import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/admin/lib/api";
import { asPage, readPages, type PagedRows } from "@/admin/lib/paging";

export interface Lead {
  id: number;
  email: string;
  consent: boolean;
  status: string;
  tags?: string[];
  extra?: Record<string, unknown>;
  notes?: string | null;
  confirmed_at?: string | null;
  created_at: string;
}

export interface AppointmentRecord {
  id: number;
  user_info: Record<string, unknown>;
  timeslot: string;
  /** The exact window, when a calendar resolved one (AppointmentResponse). */
  starts_at?: string | null;
  ends_at?: string | null;
  timezone?: string | null;
  status: string;
  tags?: string[];
  notes?: string;
  created_at: string;
}

export interface ContactSubmission {
  id: number;
  type: string;
  name: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  company?: string;
  service_description?: string;
  service_type?: string;
  budget_range?: string;
  status: string;
  /** The chat thread the request came from (chat_threads.id). */
  conversation_id?: number | null;
  created_at: string;
}

export interface FeedbackRecord {
  id: number;
  rating: number | null;
  comment: string;
  name?: string;
  email?: string;
  category?: string;
  status: string;
  conversation_id?: number | null;
  created_at: string;
}

export type ConversionCollection = "leads" | "appointments" | "submissions" | "feedback";

/**
 * How many records of a collection have a status (and, for submissions, a
 * type), over the whole collection: the API's `with_counts=1`. Escalations
 * are merged into submissions with type "escalation". `null` until a server
 * that reports them answers (an older API does not).
 */
export interface StatusCount {
  status: string;
  type?: string;
  count: number;
}
export type CollectionCounts = Record<ConversionCollection, StatusCount[] | null>;

const NO_COUNTS: CollectionCounts = { leads: null, appointments: null, submissions: null, feedback: null };

// One page per request; the tab shows a "load more" control while
// items.length < total so every record is reachable (card 2da0vftk2ucs).
const PAGE_SIZE = 100;
// Server-side cap per request, used when exporting the full collection.
const EXPORT_PAGE_SIZE = 500;
/** An export stops here: past it a file is better asked of the server than paged out in a browser. */
export const EXPORT_MAX_ROWS = 20_000;
/** Pause between export pages, so an export is not a burst against the rate limit. */
const EXPORT_PAUSE_MS = 100;

interface Envelope<T> {
  items: T[];
  total: number;
  counts: StatusCount[] | null;
}

export function asCounts(value: unknown): StatusCount[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row) => ({
      status: String(row.status ?? ""),
      ...(row.type !== undefined ? { type: String(row.type) } : {}),
      count: Number(row.count) || 0,
    }));
}

function asEnvelope<T>(res: unknown): Envelope<T> {
  if (Array.isArray(res)) return { items: res as T[], total: res.length, counts: null };
  const obj = (res || {}) as { items?: T[]; total?: number; counts?: unknown };
  const items = Array.isArray(obj.items) ? obj.items : [];
  return { items, total: typeof obj.total === "number" ? obj.total : items.length, counts: asCounts(obj.counts) };
}

async function fetchPage<T>(path: string, limit: number, offset: number, search = ""): Promise<Envelope<T>> {
  const sep = path.includes("?") ? "&" : "?";
  // The search runs on the server, over every record (not the pages loaded),
  // and the counts follow it.
  const query = search ? `&search=${encodeURIComponent(search)}` : "";
  const res = await apiFetch<unknown>(
    `${path}${sep}limit=${limit}&offset=${offset}&with_total=1&with_counts=1${query}`,
    // Paged/refreshed reads must not be served from the shared 15s GET cache,
    // or "load more" and post-delete reloads return the page just evicted.
    { cache: "reload" }
  );
  return asEnvelope<T>(res);
}

/** Submissions and escalations in one list of counts (escalations as type "escalation"). */
export function mergeSubmissionCounts(subs: StatusCount[] | null, escs: StatusCount[] | null): StatusCount[] | null {
  if (!subs || !escs) return null;
  return [...subs, ...escs.map((row) => ({ ...row, type: "escalation" }))];
}

/** Move one record from status `from` to `to` (null: a delete). */
function bump(rows: StatusCount[] | null, type: string | undefined, from: string, to: string | null): StatusCount[] | null {
  if (!rows) return rows;
  const next = rows.map((row) => ({ ...row }));
  const find = (status: string) => next.find((row) => row.status === status && (type === undefined || row.type === type));
  const old = find(from);
  if (old) old.count = Math.max(0, old.count - 1);
  if (to !== null) {
    const row = find(to);
    if (row) row.count += 1;
    else next.push({ status: to, ...(type !== undefined ? { type } : {}), count: 1 });
  }
  return next;
}

/**
 * The records of a collection for the export buttons: paged serially with a
 * short pause, at most EXPORT_MAX_ROWS (`capped` says so), and a failed page
 * ends it (`failed`, with the rows read so far).
 */
export async function fetchAllRecords<T>(path: string, maxRows = EXPORT_MAX_ROWS): Promise<PagedRows<T>> {
  const sep = path.includes("?") ? "&" : "?";
  return readPages<T>(
    async (offset, limit) => asPage<T>(await apiFetch<unknown>(`${path}${sep}limit=${limit}&offset=${offset}&with_total=1`, { cache: "reload" })),
    { pageSize: EXPORT_PAGE_SIZE, maxRows, pauseMs: EXPORT_PAUSE_MS },
  );
}

/**
 * Append a page, dropping rows already present. Two quick clicks on "Carica
 * altri" fetched the same offset twice before the first append landed, and
 * the table showed more rows than the total.
 */
function appendUnique<T extends { id: number }>(prev: T[], next: T[]): T[] {
  const seen = new Set(prev.map((row) => row.id));
  const fresh = next.filter((row) => !seen.has(row.id));
  return fresh.length ? [...prev, ...fresh] : prev;
}

const escalationToSubmission = (e: Record<string, unknown>): ContactSubmission =>
  ({
    id: -(e.id as number), // Negative ID distinguishes escalations from real submissions
    type: "escalation",
    name: (e.issue as string) || "Escalation",
    email: "",
    phone: "",
    subject: (e.issue as string) || "",
    message: (e.issue as string) || "",
    status: (e.status as string) || "pending",
    conversation_id: (e.conversation_id as number | null | undefined) ?? null,
    created_at: (e.created_at as string) || "",
    _escalation_id: e.id,
    _conversation_id: e.conversation_id,
    _channel: e.channel,
    _delivered_at: e.delivered_at,
    _error: e.error,
  }) as ContactSubmission;

/**
 * @param search Filters every collection on the server (Richieste's search
 * box, debounced by the caller). `searched` says which search the loaded rows
 * answer, so the page knows when they match what is typed.
 */
export function useConversionsData({ search = "" }: { search?: string } = {}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [appointmentsTotal, setAppointmentsTotal] = useState(0);
  const [submissions, setSubmissions] = useState<ContactSubmission[]>([]);
  // Real submissions + escalations, so the badge matches the merged tab.
  const [submissionsTotal, setSubmissionsTotal] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [counts, setCounts] = useState<CollectionCounts>(NO_COUNTS);
  const [searched, setSearched] = useState("");
  /**
   * Collections whose rows the server filtered by `searched`. An older API
   * ignores `search` (and sends no counts): its rows are the unfiltered page,
   * which the page must still filter itself.
   */
  const [serverFiltered, setServerFiltered] = useState<Record<ConversionCollection, boolean>>(
    { leads: true, appointments: true, submissions: true, feedback: true },
  );
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState<ConversionCollection | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ConversionCollection, boolean>>>({});
  const [loadMoreErrors, setLoadMoreErrors] = useState<Partial<Record<ConversionCollection, boolean>>>({});
  // Independent paging cursors for the two sources merged into "submissions".
  const [subOffset, setSubOffset] = useState(0);
  const [escOffset, setEscOffset] = useState(0);
  const [escTotal, setEscTotal] = useState(0);
  const [subOnlyTotal, setSubOnlyTotal] = useState(0);
  // Collections with a page in flight; state alone cannot stop a second click
  // that lands before React re-renders the disabled button.
  const inFlightRef = useRef<Set<ConversionCollection>>(new Set());
  // Only the latest load may publish: a search typed while another is on its
  // way must not be overwritten by the older answer.
  const loadSeq = useRef(0);
  const searchRef = useRef(search);
  searchRef.current = search;
  const searchedRef = useRef("");
  const firstLoad = useRef(true);
  // The rows, for the status and delete helpers that adjust the counts.
  const rowsRef = useRef({ leads, appointments, submissions, feedback });
  rowsRef.current = { leads, appointments, submissions, feedback };

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const term = searchRef.current;
    // A new search keeps the current rows on screen until its answer lands;
    // the first load and Aggiorna show the loading state.
    const changed = term !== searchedRef.current;
    const quiet = !firstLoad.current && changed;
    firstLoad.current = false;
    if (!quiet) setLoading(true);
    setLoadMoreErrors({});
    try {
      const [leadsRes, apptRes, subRes, fbRes, escRes] = await Promise.allSettled([
        fetchPage<Lead>("/tools/leads", PAGE_SIZE, 0, term),
        fetchPage<AppointmentRecord>("/tools/appointments", PAGE_SIZE, 0, term),
        fetchPage<ContactSubmission>("/contact-submissions", PAGE_SIZE, 0, term),
        fetchPage<FeedbackRecord>("/feedback", PAGE_SIZE, 0, term),
        fetchPage<Record<string, unknown>>("/tools/escalations", PAGE_SIZE, 0, term),
      ]);
      if (seq !== loadSeq.current) return;
      searchedRef.current = term;
      setSearched(term);
      const understood = (res: PromiseSettledResult<Envelope<unknown>>) =>
        !term || (res.status === "fulfilled" && res.value.counts !== null);
      setServerFiltered({
        leads: understood(leadsRes),
        appointments: understood(apptRes),
        submissions: understood(subRes) && understood(escRes),
        feedback: understood(fbRes),
      });
      setCounts({
        leads: leadsRes.status === "fulfilled" ? leadsRes.value.counts : null,
        appointments: apptRes.status === "fulfilled" ? apptRes.value.counts : null,
        submissions: subRes.status === "fulfilled" && escRes.status === "fulfilled"
          ? mergeSubmissionCounts(subRes.value.counts, escRes.value.counts)
          : null,
        feedback: fbRes.status === "fulfilled" ? fbRes.value.counts : null,
      });
      // A rejected request is not an empty collection. Keep the last known
      // data, and let each tab offer an explicit retry instead of onboarding;
      // but rows of another search would pass for matches of this one.
      if (changed) {
        if (leadsRes.status === "rejected") { setLeads([]); setLeadsTotal(0); }
        if (apptRes.status === "rejected") { setAppointments([]); setAppointmentsTotal(0); }
        if (subRes.status === "rejected" || escRes.status === "rejected") {
          setSubmissions([]);
          setSubOffset(0);
          setEscOffset(0);
          setSubOnlyTotal(0);
          setEscTotal(0);
          setSubmissionsTotal(0);
        }
        if (fbRes.status === "rejected") { setFeedback([]); setFeedbackTotal(0); }
      }
      setErrors({
        leads: leadsRes.status === "rejected",
        appointments: apptRes.status === "rejected",
        submissions: subRes.status === "rejected" || escRes.status === "rejected",
        feedback: fbRes.status === "rejected",
      });
      if (leadsRes.status === "fulfilled") {
        setLeads(leadsRes.value.items);
        setLeadsTotal(leadsRes.value.total);
      }
      if (apptRes.status === "fulfilled") {
        setAppointments(apptRes.value.items);
        setAppointmentsTotal(apptRes.value.total);
      }
      // Both sources must succeed before publishing a complete Requests view.
      if (subRes.status === "fulfilled" && escRes.status === "fulfilled") {
        const subPage = subRes.value;
        const escPage = escRes.value;
        const merged = [...subPage.items, ...escPage.items.map(escalationToSubmission)].sort(
          (a, b) => b.created_at.localeCompare(a.created_at)
        );
        setSubmissions(merged);
        setSubOffset(subPage.items.length);
        setEscOffset(escPage.items.length);
        setSubOnlyTotal(subPage.total);
        setEscTotal(escPage.total);
        setSubmissionsTotal(subPage.total + escPage.total);
      }
      if (fbRes.status === "fulfilled") {
        setFeedback(fbRes.value.items);
        setFeedbackTotal(fbRes.value.total);
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(
    async (which: ConversionCollection) => {
      if (inFlightRef.current.has(which)) return;
      inFlightRef.current.add(which);
      setLoadingMore(which);
      setLoadMoreErrors((prev) => ({ ...prev, [which]: false }));
      // A page asked for before a new load (a search typed meanwhile) belongs
      // to the old rows: appending it would mix them into the new answer.
      const gen = loadSeq.current;
      const stale = () => gen !== loadSeq.current;
      try {
        if (which === "leads") {
          const page = await fetchPage<Lead>("/tools/leads", PAGE_SIZE, leads.length, searchedRef.current);
          if (stale()) return;
          setLeads((prev) => appendUnique(prev, page.items));
          setLeadsTotal(page.total);
        } else if (which === "appointments") {
          const page = await fetchPage<AppointmentRecord>("/tools/appointments", PAGE_SIZE, appointments.length, searchedRef.current);
          if (stale()) return;
          setAppointments((prev) => appendUnique(prev, page.items));
          setAppointmentsTotal(page.total);
        } else if (which === "feedback") {
          const page = await fetchPage<FeedbackRecord>("/feedback", PAGE_SIZE, feedback.length, searchedRef.current);
          if (stale()) return;
          setFeedback((prev) => appendUnique(prev, page.items));
          setFeedbackTotal(page.total);
        } else {
          const wantSubs = subOffset < subOnlyTotal;
          const wantEscs = escOffset < escTotal;
          const [subPage, escPage] = await Promise.all([
            wantSubs
              ? fetchPage<ContactSubmission>("/contact-submissions", PAGE_SIZE, subOffset, searchedRef.current)
              : Promise.resolve<Envelope<ContactSubmission>>({ items: [], total: subOnlyTotal, counts: null }),
            wantEscs
              ? fetchPage<Record<string, unknown>>("/tools/escalations", PAGE_SIZE, escOffset, searchedRef.current)
              : Promise.resolve<Envelope<Record<string, unknown>>>({ items: [], total: escTotal, counts: null }),
          ]);
          if (stale()) return;
          setSubmissions((prev) =>
            [...appendUnique(prev, [...subPage.items, ...escPage.items.map(escalationToSubmission)])].sort(
              (a, b) => b.created_at.localeCompare(a.created_at)
            )
          );
          setSubOffset((prev) => prev + subPage.items.length);
          setEscOffset((prev) => prev + escPage.items.length);
          setSubOnlyTotal(subPage.total);
          setEscTotal(escPage.total);
          setSubmissionsTotal(subPage.total + escPage.total);
        }
      } catch {
        // Retain the loaded rows and cursors so retry requests the same page.
        if (!stale()) setLoadMoreErrors((prev) => ({ ...prev, [which]: true }));
      } finally {
        inFlightRef.current.delete(which);
        setLoadingMore(null);
      }
    },
    [leads.length, appointments.length, feedback.length, subOffset, escOffset, subOnlyTotal, escTotal]
  );

  const updateSubmissionStatus = useCallback(
    async (id: number, status: string) => {
      await apiFetch(`/contact-submissions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const row = rowsRef.current.submissions.find((s) => s.id === id);
      if (row && row.status !== status) {
        setCounts((prev) => ({ ...prev, submissions: bump(prev.submissions, row.type, row.status, status) }));
      }
      setSubmissions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status } : s)),
      );
    },
    [],
  );

  const updateFeedbackStatus = useCallback(
    async (id: number, status: string) => {
      await apiFetch(`/feedback/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const row = rowsRef.current.feedback.find((f) => f.id === id);
      if (row && row.status !== status) {
        setCounts((prev) => ({ ...prev, feedback: bump(prev.feedback, undefined, row.status, status) }));
      }
      setFeedback((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status } : f)),
      );
    },
    [],
  );

  const updateAppointmentStatus = useCallback(
    async (id: number, status: string) => {
      await apiFetch(`/tools/appointments/${id}`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      const row = rowsRef.current.appointments.find((a) => a.id === id);
      if (row && row.status !== status) {
        setCounts((prev) => ({ ...prev, appointments: bump(prev.appointments, undefined, row.status, status) }));
      }
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status } : a)),
      );
    },
    [],
  );

  /** Escalations sit in `submissions` under a negative id (see escalationToSubmission). */
  const updateEscalationStatus = useCallback(
    async (id: number, status: string) => {
      await apiFetch(`/tools/escalations/${id}`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      const row = rowsRef.current.submissions.find((s) => s.id === -id);
      if (row && row.status !== status) {
        setCounts((prev) => ({ ...prev, submissions: bump(prev.submissions, "escalation", row.status, status) }));
      }
      setSubmissions((prev) =>
        prev.map((s) => (s.id === -id ? { ...s, status } : s)),
      );
    },
    [],
  );

  /** Move an appointment to a new exact window; the API checks a connected calendar for clashes. */
  const rescheduleAppointment = useCallback(
    async (id: number, window: { starts_at: string; ends_at: string; timezone?: string | null }) => {
      const updated = await apiFetch<Partial<AppointmentRecord>>(`/tools/appointments/${id}`, {
        method: "POST",
        body: JSON.stringify(window),
      });
      setAppointments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...window, ...(updated && typeof updated === "object" && "id" in updated ? updated : {}) } : a)),
      );
    },
    [],
  );

  const deleteLead = useCallback(async (id: number) => {
    await apiFetch(`/tools/leads/${id}`, { method: "DELETE" });
    const row = rowsRef.current.leads.find((l) => l.id === id);
    if (row) setCounts((prev) => ({ ...prev, leads: bump(prev.leads, undefined, row.status, null) }));
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setLeadsTotal((prev) => Math.max(0, prev - 1));
  }, []);

  const deleteAppointment = useCallback(async (id: number) => {
    await apiFetch(`/tools/appointments/${id}`, { method: "DELETE" });
    const row = rowsRef.current.appointments.find((a) => a.id === id);
    if (row) setCounts((prev) => ({ ...prev, appointments: bump(prev.appointments, undefined, row.status, null) }));
    setAppointments((prev) => prev.filter((a) => a.id !== id));
    setAppointmentsTotal((prev) => Math.max(0, prev - 1));
  }, []);

  const deleteSubmission = useCallback(async (id: number) => {
    await apiFetch(`/contact-submissions/${id}`, { method: "DELETE" });
    const row = rowsRef.current.submissions.find((s) => s.id === id);
    if (row) setCounts((prev) => ({ ...prev, submissions: bump(prev.submissions, row.type, row.status, null) }));
    setSubmissions((prev) => prev.filter((s) => s.id !== id));
    setSubOffset((prev) => Math.max(0, prev - 1));
    setSubmissionsTotal((prev) => Math.max(0, prev - 1));
    setSubOnlyTotal((prev) => Math.max(0, prev - 1));
  }, []);

  /** One escalation by its own (positive) id; it sits in `submissions` under -id. The conversation stays. */
  const deleteEscalation = useCallback(async (id: number) => {
    await apiFetch(`/tools/escalations/${id}`, { method: "DELETE" });
    const row = rowsRef.current.submissions.find((s) => s.id === -id);
    if (row) setCounts((prev) => ({ ...prev, submissions: bump(prev.submissions, "escalation", row.status, null) }));
    setSubmissions((prev) => prev.filter((s) => s.id !== -id));
    setEscOffset((prev) => Math.max(0, prev - 1));
    setEscTotal((prev) => Math.max(0, prev - 1));
    setSubmissionsTotal((prev) => Math.max(0, prev - 1));
  }, []);

  const deleteFeedback = useCallback(async (id: number) => {
    await apiFetch(`/feedback/${id}`, { method: "DELETE" });
    const row = rowsRef.current.feedback.find((f) => f.id === id);
    if (row) setCounts((prev) => ({ ...prev, feedback: bump(prev.feedback, undefined, row.status, null) }));
    setFeedback((prev) => prev.filter((f) => f.id !== id));
    setFeedbackTotal((prev) => Math.max(0, prev - 1));
  }, []);

  // Collection-wide deletes run server-side so they cover every record,
  // not just the pages loaded in the browser (card 2da0vftk2ucs).
  const deleteAllLeads = useCallback(async () => {
    await apiFetch(`/tools/leads`, { method: "DELETE" });
    setCounts((prev) => ({ ...prev, leads: prev.leads && [] }));
    setLeads([]);
    setLeadsTotal(0);
  }, []);

  const deleteAllAppointments = useCallback(async () => {
    await apiFetch(`/tools/appointments`, { method: "DELETE" });
    setCounts((prev) => ({ ...prev, appointments: prev.appointments && [] }));
    setAppointments([]);
    setAppointmentsTotal(0);
  }, []);

  const deleteAllSubmissions = useCallback(async () => {
    await apiFetch(`/contact-submissions`, { method: "DELETE" });
    // Escalations are operational records tied to conversations; they stay.
    setCounts((prev) => ({ ...prev, submissions: prev.submissions && prev.submissions.filter((row) => row.type === "escalation") }));
    setSubmissions((prev) => prev.filter((s) => s.type === "escalation"));
    setSubOffset(0);
    setSubOnlyTotal(0);
    setSubmissionsTotal(escTotal);
  }, [escTotal]);

  /** Every escalation record; the conversations they came from keep their status. */
  const deleteAllEscalations = useCallback(async () => {
    await apiFetch(`/tools/escalations`, { method: "DELETE" });
    setCounts((prev) => ({ ...prev, submissions: prev.submissions && prev.submissions.filter((row) => row.type !== "escalation") }));
    setSubmissions((prev) => prev.filter((s) => s.type !== "escalation"));
    setEscOffset(0);
    setEscTotal(0);
    setSubmissionsTotal(subOnlyTotal);
  }, [subOnlyTotal]);

  const deleteAllFeedback = useCallback(async () => {
    await apiFetch(`/feedback`, { method: "DELETE" });
    setCounts((prev) => ({ ...prev, feedback: prev.feedback && [] }));
    setFeedback([]);
    setFeedbackTotal(0);
  }, []);

  // The first load, and a new one whenever the search changes.
  useEffect(() => {
    void load();
  }, [load, search]);

  return {
    leads,
    leadsTotal,
    appointments,
    appointmentsTotal,
    submissions,
    submissionsTotal,
    // Real submissions only — what "delete all" can actually remove.
    submissionsDeletableTotal: subOnlyTotal,
    escalationsTotal: escTotal,
    feedback,
    feedbackTotal,
    counts,
    searched,
    serverFiltered,
    loading,
    loadingMore,
    errors,
    loadMoreErrors,
    reload: load,
    loadMore,
    updateSubmissionStatus,
    updateFeedbackStatus,
    updateAppointmentStatus,
    updateEscalationStatus,
    rescheduleAppointment,
    deleteLead,
    deleteAppointment,
    deleteSubmission,
    deleteEscalation,
    deleteFeedback,
    deleteAllLeads,
    deleteAllAppointments,
    deleteAllSubmissions,
    deleteAllEscalations,
    deleteAllFeedback,
  };
}
