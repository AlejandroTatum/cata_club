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

interface PaginatedPersonas {
  items: BackendPersonaFull[];
  total: number;
}

interface PaginatedPagos {
  items: BackendPagoListItem[];
}

interface PaginatedMembresias {
  items: BackendMembresia[];
  total: number;
}

type MembresiasFetchResult =
  | { ok: true; items: BackendMembresia[] }
  | { ok: false };

/**
 * `GET /membresias/` is paginated at the backend (tope 200) — a single call
 * silently truncates once the club has more than 200 membership rows, which
 * happens well before it has 200 PERSONAS: a membership accumulates per
 * persona over time (vencida, inactiva, la activa), so the membership table
 * outgrows the persona table. `personasCapped` (below) would stay false
 * while a real chunk of the membership map was already gone — a swallowed
 * truncation must never render as a confident membership-less student, same
 * principle as `membresiasDegraded`. This loops every page instead.
 */
async function fetchAllMembresias(request: NextRequest): Promise<MembresiasFetchResult> {
  const items: BackendMembresia[] = [];
  let skip = 0;
  while (true) {
    const result = await backendFetchAuthed(request, `/membresias/?skip=${skip}&limit=${MEMBRESIAS_PAGE_LIMIT}`);
    if (!result.ok || !result.response.ok) return { ok: false };
    const page = (await result.response.json()) as PaginatedMembresias;
    items.push(...page.items);
    if (page.items.length < MEMBRESIAS_PAGE_LIMIT || items.length >= page.total) break;
    skip += MEMBRESIAS_PAGE_LIMIT;
  }
  return { ok: true, items };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const personasResult = await backendFetchAuthed(request, `/personas/?limit=${PERSONAS_PAGE_LIMIT}`);
  if (!personasResult.ok) {
    return NextResponse.json({ message: "No se pudieron cargar las personas." }, { status: personasResult.status });
  }
  if (!personasResult.response.ok) {
    return passthroughBackendError(personasResult.response, "No se pudieron cargar las personas.");
  }
  const personasBody = (await personasResult.response.json()) as PaginatedPersonas;

  const [pagosResult, tiposResult, membresiasFetch] = await Promise.all([
    backendFetchAuthed(request, "/membresias/pagos?limit=200"),
    backendFetchAuthed(request, "/membresias/tipos"),
    fetchAllMembresias(request),
  ]);

  const pagos: BackendPagoListItem[] =
    pagosResult.ok && pagosResult.response.ok ? ((await pagosResult.response.json()) as PaginatedPagos).items : [];
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
