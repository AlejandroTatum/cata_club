/**
 * Server-only helper for draining a paginated FastAPI list endpoint.
 *
 * Every paginated backend list answers `{items, total, skip, limit}` and caps
 * `limit` at 200, so a single call silently truncates any table that has
 * outgrown that cap. Truncation is the failure this exists to prevent: a
 * swallowed one renders as a confident absence — a socio with no membership,
 * a socio with no payment — which is worse than an error, because nothing
 * about it looks wrong.
 *
 * Two rules follow from that:
 *
 * 1. A page that fails mid-loop fails the WHOLE source. A partial list is the
 *    same lie as a truncated one: the rows on the missing page are
 *    indistinguishable from rows that never existed.
 * 2. The loop is bounded. Its normal exits are a short page and
 *    `items.length >= total`; a response that answers full pages while
 *    omitting `total` satisfies neither, because `n >= undefined` is false in
 *    JS. Unbounded, that spins the Route Handler until its deadline with the
 *    browser's request held open. `MAX_PAGES_PER_SOURCE` turns a backend
 *    that misreports `total` or ignores `skip` into the same honest
 *    degradation a failed page already produces.
 */

import type { NextRequest } from "next/server";
import { backendFetchAuthed } from "@/lib/server/backend-client";

/**
 * Hard bound on pages drained from one source. At the backend's 200-row cap
 * this is 10 000 rows — the same ceiling `LIMITE_MAXIMO_REPORTE_PAGOS` puts
 * on the pagos report, so neither side promises more than the other can hold.
 */
export const MAX_PAGES_PER_SOURCE = 50;

/** The envelope every paginated FastAPI list endpoint answers with. */
export interface PaginatedPage<T> {
  items: T[];
  total: number;
}

export type PagedFetchResult<T> = { ok: true; items: T[] } | { ok: false };

export async function fetchAllPages<T>(
  request: NextRequest,
  path: string,
  limit: number,
): Promise<PagedFetchResult<T>> {
  const separator = path.includes("?") ? "&" : "?";
  const items: T[] = [];
  let skip = 0;

  for (let page = 0; page < MAX_PAGES_PER_SOURCE; page += 1) {
    const result = await backendFetchAuthed(request, `${path}${separator}skip=${skip}&limit=${limit}`);
    if (!result.ok || !result.response.ok) return { ok: false };

    const body = (await result.response.json()) as PaginatedPage<T>;
    items.push(...body.items);
    if (body.items.length < limit || items.length >= body.total) return { ok: true, items };
    skip += limit;
  }

  // Fell out of the bound with the source still claiming more rows: what we
  // hold is a prefix, and a prefix must not be served as the whole list.
  //
  // This one degradation has to announce itself. The two ordinary reasons for
  // `{ok:false}` — a failed page, a backend outage — are transient and show up
  // elsewhere; this one is a standing condition (the table really did outgrow
  // the ceiling, or the backend really is misreporting `total`) that would
  // otherwise repeat on every request while looking exactly like a blip. A
  // degradation nobody can observe is one nobody will ever fix.
  console.warn(
    `[paged-fetch] ${path} exhausted MAX_PAGES_PER_SOURCE (${MAX_PAGES_PER_SOURCE} pages of ${limit}); ` +
      `holding ${items.length} rows, discarding them as an incomplete prefix`,
  );
  return { ok: false };
}
