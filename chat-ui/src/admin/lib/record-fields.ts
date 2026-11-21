/**
 * Field readers for the tool records the API returns, shared by
 * Strumenti (tools-page) and Registro Attività (conversions-page).
 *
 * The two pages used to read the same rows with different keys: Strumenti
 * looked for `name`/`email`/`date` on appointments (the API nests them under
 * `user_info` and `timeslot`) and `consented` on leads (the API field is
 * `consent`), so its columns showed "-" and every lead read "Senza consenso".
 * Shapes: AppointmentResponse, EmailLeadResponse, EscalationResponse in
 * app/schemas.py.
 */

// Typed records (Lead, AppointmentRecord) and the tools page's loose rows both fit.
type Row = object;

const field = (row: Row, key: string): unknown => (row as Record<string, unknown>)[key];

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

function info(row: Row): Record<string, unknown> {
  const value = field(row, "user_info");
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * A person's name as shown and exported: "Edrick Edrick" reads "Edrick".
 * Records saved before the API collapsed a name typed twice (first and last
 * name fields both holding the full name) still carry it; the same rule runs
 * at the source in app/utils.py collapse_repeated_name.
 */
export function personName(value: unknown): string {
  const words = text(value).split(/\s+/).filter(Boolean);
  const half = words.length / 2;
  if (half >= 1 && Number.isInteger(half)) {
    const lower = words.map((w) => w.toLocaleLowerCase());
    if (lower.slice(0, half).join(" ") === lower.slice(half).join(" ")) return words.slice(0, half).join(" ");
  }
  return words.join(" ");
}

export function appointmentName(row: Row): string {
  const user = info(row);
  return personName(user.name) || personName(user.full_name);
}

export function appointmentEmail(row: Row): string {
  return text(info(row).email);
}

export function appointmentPhone(row: Row): string {
  return text(info(row).phone);
}

/** The booked time: the exact window when the calendar resolved one, else the timeslot text. */
export function appointmentTime(row: Row): string {
  return text(field(row, "starts_at")) || text(field(row, "timeslot"));
}

/** The API stores consent as `consent`; there is no other source of truth. */
export function leadConsent(row: Row): boolean {
  return field(row, "consent") === true;
}

export function leadName(row: Row): string {
  const value = field(row, "extra");
  const extra = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return personName(extra.name) || personName(extra.full_name);
}

const STATUS_KEYS: Record<string, string> = {
  pending: "conversions.statusPending",
  read: "conversions.statusRead",
  replied: "conversions.statusReplied",
  received: "conversions.statusReceived",
  reviewed: "conversions.statusReviewed",
  published: "conversions.statusPublished",
  scheduled: "conversions.statusScheduled",
  active: "conversions.statusActive",
  expired: "conversions.statusExpired",
  disabled: "conversions.statusDisabled",
  upcoming: "conversions.statusUpcoming",
  cancelled: "conversions.statusCancelled",
  captured: "conversions.statusCaptured",
  open: "conversions.statusOpen",
  closed: "conversions.statusClosed",
  escalated: "conversions.statusEscalated",
  confirmed: "conversions.statusConfirmed",
  completed: "conversions.statusCompleted",
  submitted: "conversions.statusSubmitted",
  // Escalation delivery states (app/main.py escalation tool).
  delivered: "conversions.statusDelivered",
  failed: "conversions.statusFailed",
  resolved: "conversions.statusResolved",
};

/** Localized label for a record status; unknown values pass through unchanged. */
export function statusLabel(t: (key: string) => string, status: string): string {
  const key = STATUS_KEYS[status];
  const label = key ? t(key) : "";
  return label && label !== key ? label : status;
}
