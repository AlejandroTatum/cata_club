/**
 * GET /api/members — aggregates FastAPI's `/personas`, `/membresias/pagos*`
 * and `/membresias/*` into the `MemberAccount[]` shape
 * src/app/members/page.tsx renders (see src/lib/server/members-adapter.ts
 * for the DTO translation and the backend gaps found while building it).
 * Mirrors src/app/api/payments/route.ts's aggregation style.
 *
 * `GET /membresias/pagos` is best-effort: this page's own protection
 * (`allowedRoles={["admin"]}`) covers the admin-only payments queue in
 * practice, but if it fails (e.g. a future non-admin caller) the response
 * still renders — accounts without resolvable membership data, not a hard
 * failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { buildMemberAccounts, type BackendPersonaFull } from "@/lib/server/members-adapter";
import type { BackendMembresia, BackendPagoListItem, BackendTipoMembresia } from "@/lib/server/payments-adapter";

const PERSONAS_PAGE_LIMIT = 200;
const MEMBRESIAS_PAGE_LIMIT = 200;
const PAGOS_PAGE_LIMIT = 200;

/** The envelope every paginated FastAPI list endpoint answers with. */
interface PaginatedPage<T> {
  items: T[];
  total: number;
}

type PaginatedPersonas = PaginatedPage<BackendPersonaFull>;

type PagedFetchResult<T> = { ok: true; items: T[] } | { ok: false };

/**
 * Both `GET /membresias/` and `GET /membresias/pagos` are paginated at the
 * backend (tope 200) — a single call silently truncates once the club has
 * more than 200 rows in either table, which happens well before it has 200
 * PERSONAS: memberships accumulate per persona over time (vencida, inactiva,
 * la activa) and payments accumulate one row per renewal, so both tables
 * outgrow the persona table. `personasCapped` (below) would stay false while
 * a real chunk of either map was already gone — a swallowed truncation must
 * never render as a confident membership-less or payment-less student, same
 * principle as `membresiasDegraded`. This loops every page instead.
 *
 * A page that fails mid-loop fails the WHOLE source rather than returning
 * what arrived so far: a partial list is the same lie as a truncated one,
 * because the personas on the missing page render as an absence with the
 * same confidence as the ones who genuinely have no row.
 */
async function fetchAllPages<T>(
  request: NextRequest,
  path: string,
  limit: number,
): Promise<PagedFetchResult<T>> {
  const separator = path.includes("?") ? "&" : "?";
  const items: T[] = [];
  let skip = 0;
  while (true) {
    const result = await backendFetchAuthed(request, `${path}${separator}skip=${skip}&limit=${limit}`);
    if (!result.ok || !result.response.ok) return { ok: false };
    const page = (await result.response.json()) as PaginatedPage<T>;
    items.push(...page.items);
    if (page.items.length < limit || items.length >= page.total) break;
    skip += limit;
  }
  return { ok: true, items };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  /*
   * All four sources are independent — nothing in the pagos/tipos/membresías
   * batch reads the personas response — so they go out together. Awaiting
   * personas first only split four independent round trips into two stages,
   * and since each `backendFetchAuthed` carries its own deadline, that stage
   * was real latency on the heaviest admin screen. The array order is also
   * the dispatch order, which is what the positional fetch mocks in
   * `__tests__/route.test.ts` assert against.
   */
  const [personasResult, pagosFetch, tiposResult, membresiasFetch] = await Promise.all([
    backendFetchAuthed(request, `/personas/?limit=${PERSONAS_PAGE_LIMIT}`),
    fetchAllPages<BackendPagoListItem>(request, "/membresias/pagos", PAGOS_PAGE_LIMIT),
    backendFetchAuthed(request, "/membresias/tipos"),
    fetchAllPages<BackendMembresia>(request, "/membresias/", MEMBRESIAS_PAGE_LIMIT),
  ]);

  if (!personasResult.ok) {
    return NextResponse.json({ message: "No se pudieron cargar las personas." }, { status: personasResult.status });
  }
  if (!personasResult.response.ok) {
    return passthroughBackendError(personasResult.response, "No se pudieron cargar las personas.");
  }
  const personasBody = (await personasResult.response.json()) as PaginatedPersonas;

  const pagos: BackendPagoListItem[] = pagosFetch.ok ? pagosFetch.items : [];
  const tipos: BackendTipoMembresia[] =
    tiposResult.ok && tiposResult.response.ok ? await tiposResult.response.json() : [];

  const latestPagoByPersona = new Map<number, BackendPagoListItem>();
  for (const pago of pagos) {
    const current = latestPagoByPersona.get(pago.personaId);
    if (!current || new Date(pago.fechaRegistro) > new Date(current.fechaRegistro)) {
      latestPagoByPersona.set(pago.personaId, pago);
    }
  }

  /*
   * Memberships are resolved from `GET /membresias/`, paged in full (see
   * `fetchAllMembresias`) — same looping pattern `/api/attendance/records`
   * uses for TRA-6. The N individual `/membresias/{id}` /
   * `/membresias/persona/{id}` lookups this route used to make (one batch of
   * requests per unique membership, another per persona without a payment —
   * ~120 calls for 59 students) existed to work around `GET /membresias/`
   * answering 500. That bug is fixed; the bulk list now carries `personaId`
   * on every row, so both maps below come from the same paged fetch.
   */
  const membresiasDegraded = !membresiasFetch.ok;
  const membresias: BackendMembresia[] = membresiasFetch.ok ? membresiasFetch.items : [];

  const membresiaById = new Map<number, BackendMembresia>();
  const membresiasByPersona = new Map<number, BackendMembresia[]>();
  for (const membresia of membresias) {
    membresiaById.set(membresia.id, membresia);
    if (membresia.personaId === undefined) continue;
    const list = membresiasByPersona.get(membresia.personaId) ?? [];
    list.push(membresia);
    membresiasByPersona.set(membresia.personaId, list);
  }

  /*
   * A membership can exist with no payment behind it — three personas in the
   * current data hold an ACTIVA membresía and zero Pago rows, so the payment
   * chain above cannot see them at all. This is the fallback
   * `buildMemberStudentSummary` reaches for in that case.
   */
  const membresiaByPersona = new Map<number, BackendMembresia>();
  for (const [personaId, items] of membresiasByPersona) {
    // An ACTIVA membership is the one worth showing; otherwise the first
    // row, so a VENCIDA still reads as a lapsed member rather than as none.
    membresiaByPersona.set(personaId, items.find((m) => m.estado === "ACTIVA") ?? items[0]);
  }

  const tipoById = new Map(tipos.map((tipo) => [tipo.id, tipo]));

  const accounts = buildMemberAccounts(
    personasBody.items,
    latestPagoByPersona,
    membresiaById,
    membresiaByPersona,
    tipoById,
  );

  const personasCapped = personasBody.total >= PERSONAS_PAGE_LIMIT;
  const response = NextResponse.json({ accounts, personasCapped, membresiasDegraded });
  if (personasResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: personasResult.refreshedAccessToken });
  }
  return response;
}
