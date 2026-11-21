import { ApiRequestError, errorText } from "@/admin/lib/api";
import { interpolate, type TFunction } from "@/admin/lib/i18n";

/**
 * What Domande frequenti says when a request fails (card gxo6eh1izsvo). The
 * hooks used to put the server's message in the page's error banner as is:
 * English, and naming internals ("Blocked by QA guard", "Invalid category.",
 * "HelpDesk entry not found"). Now each action has its Italian sentence, the
 * reason the owner can act on is added (offline, expired session, too many
 * requests), and the few 4xx answers the API really gives get their own words:
 *
 * - 409 on a category: one with that name exists (the API's only duplicate
 *   check; FAQs have none, the page warns about a repeated question itself);
 * - 422 on a category: the name is blank or over 100 characters
 *   (HelpdeskCategoryCreate); there is no "too long" answer for a FAQ;
 * - 404 on a FAQ or a category: it was deleted meanwhile;
 * - 400 "Invalid category." on a FAQ: its category is gone;
 * - 400 "Missing content" on an import: the file had nothing to read.
 *
 * The plugin relays these statuses (AlphaRecall_Rest::upstream_status). The raw
 * message only goes to the console.
 */
export type FaqAction =
  | "load" | "add" | "save" | "delete" | "reorder" | "generate" | "import"
  | "categoryLoad" | "categoryAdd" | "categorySave" | "categoryDelete";

const ACTION_KEY: Record<FaqAction, string> = {
  load: "helpdesk.errors.load",
  add: "helpdesk.errors.save",
  save: "helpdesk.errors.save",
  delete: "helpdesk.errors.delete",
  reorder: "helpdesk.errors.reorder",
  generate: "helpdesk.errors.generate",
  import: "helpdesk.errors.import",
  categoryLoad: "helpdesk.errors.categoryLoad",
  categoryAdd: "helpdesk.errors.categorySave",
  categorySave: "helpdesk.errors.categorySave",
  categoryDelete: "helpdesk.errors.categoryDelete",
};

const isCategory = (action: FaqAction) => action.startsWith("category");

/** The known 4xx answers, as the i18n key of what to say instead. */
function knownReason(error: ApiRequestError, action: FaqAction): string | null {
  const { status } = error;
  const message = error.message.trim();
  if (isCategory(action)) {
    if (status === 409) return "helpdesk.errors.categoryDuplicate";
    if (status === 422 && (action === "categoryAdd" || action === "categorySave")) return "helpdesk.errors.categoryInvalid";
    if (status === 404 && action !== "categoryLoad") return "helpdesk.errors.categoryGone";
    return null;
  }
  if (status === 404 && (action === "save" || action === "delete")) return "helpdesk.errors.faqGone";
  if (status === 400 && /^invalid category\.?$/i.test(message) && (action === "add" || action === "save")) return "helpdesk.errors.categoryMissing";
  if (status === 400 && /^missing content\.?$/i.test(message) && action === "import") return "helpdesk.errors.importEmpty";
  return null;
}

/** The sentence for a failed FAQ (or FAQ category) request; logs the raw error. */
export function faqErrorText(error: unknown, action: FaqAction, t: TFunction): string {
  console.error(`[helpdesk] ${action} failed:`, error instanceof Error ? error.message : error);
  if (error instanceof FaqFileTooBig) return interpolate(t("helpdesk.errors.importTooBig"), { kb: Math.round(error.max / 1000) });
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
    const reason = knownReason(error, action);
    if (reason) return t(reason);
  }
  const failed = t(ACTION_KEY[action]);
  const withReason = errorText(error, failed);
  // No reason the owner can act on: just ask to try again.
  return withReason === failed ? `${failed} ${t("helpdesk.errors.retry")}` : withReason;
}

/** An import refused before sending it: the file is over the size the proxy accepts. */
export class FaqFileTooBig extends Error {
  constructor(public readonly max: number) {
    super(`File over ${max} bytes.`);
    this.name = "FaqFileTooBig";
  }
}
