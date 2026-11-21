/**
 * Reading a whole paged collection (an export, the Contatti badges) without
 * becoming a burst against the API's rate limit: pages one at a time, a short
 * pause between them, a row cap, and the first failed page ends the read.
 * Retrying belongs to the request layer (lib/api.ts), never to a loop here.
 */

export interface Page<T> {
  items: T[];
  /** The collection's size when the endpoint reports it (`with_total=1`), else null. */
  total: number | null;
}

export interface PagedRows<T> {
  rows: T[];
  /** Every row was read. */
  complete: boolean;
  /** Stopped at `maxRows` with more left on the server. */
  capped: boolean;
  /** A page failed; `rows` holds what came before it. */
  failed: boolean;
  /** The last total the endpoint reported, or null. */
  total: number | null;
}

export interface ReadPagesOptions {
  pageSize: number;
  maxRows: number;
  /** Pause between two pages, in ms. */
  pauseMs?: number;
  /** Checked before each page: false stops the read (the page went away). */
  keepGoing?: () => boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Read pages from offset 0 until the collection ends, `maxRows` is reached or
 * a page fails. The end is the reported total when there is one (an endpoint
 * may cap the page below the limit asked for), else a short or empty page.
 */
export async function readPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  { pageSize, maxRows, pauseMs = 0, keepGoing }: ReadPagesOptions,
): Promise<PagedRows<T>> {
  const rows: T[] = [];
  let total: number | null = null;
  while (rows.length < maxRows) {
    if (keepGoing && !keepGoing()) return { rows, complete: false, capped: false, failed: false, total };
    const limit = Math.min(pageSize, maxRows - rows.length);
    let page: Page<T>;
    try {
      page = await fetchPage(rows.length, limit);
    } catch {
      return { rows, complete: false, capped: false, failed: true, total };
    }
    rows.push(...page.items);
    if (page.total !== null) total = page.total;
    const ended = page.items.length === 0
      || (total !== null ? rows.length >= total : page.items.length < limit);
    if (ended) return { rows, complete: true, capped: false, failed: false, total };
    if (pauseMs > 0 && rows.length < maxRows) await sleep(pauseMs);
  }
  return { rows, complete: false, capped: true, failed: false, total };
}

/** `{items, total}` envelopes and bare arrays, as the list endpoints answer. */
export function asPage<T>(res: unknown): Page<T> {
  if (Array.isArray(res)) return { items: res as T[], total: null };
  const obj = (res || {}) as { items?: unknown; total?: unknown };
  const items = Array.isArray(obj.items) ? (obj.items as T[]) : [];
  const total = Number(obj.total);
  return { items, total: obj.total !== undefined && obj.total !== null && Number.isFinite(total) ? total : null };
}
