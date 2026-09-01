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
import { readsAsVencida } from "@/lib/membership-status";
import {
  buildMemberAccounts,
  resolveMembresiaParaPersona,
  selectMembresiaParaPersona,
  type BackendPersonaFull,
  type DeudaBulkItem,
} from "@/lib/server/members-adapter";
import { fetchAllPages, type PaginatedPage } from "@/lib/server/paged-fetch";
import type { BackendMembresia, BackendPagoListItem, BackendTipoMembresia } from "@/lib/server/payments-adapter";

const PERSONAS_PAGE_LIMIT = 200;
const MEMBRESIAS_PAGE_LIMIT = 200;
const PAGOS_PAGE_LIMIT = 200;

type PaginatedPersonas = PaginatedPage<BackendPersonaFull>;
type MembershipMaps = {
  byId: Map<number, BackendMembresia>;
  byPersona: Map<number, BackendMembresia>;
};
type BackendDeudaBulkItem = {
  membresiaId: number;
  mesesAdeudados: number;
  montoMensual: string;
};

function latestPaymentsByPersona(pagos: BackendPagoListItem[]): Map<number, BackendPagoListItem> {
  const latest = new Map<number, BackendPagoListItem>();
  for (const pago of pagos) {
    const current = latest.get(pago.personaId);
    if (!current || new Date(pago.fechaRegistro) > new Date(current.fechaRegistro)) {
      latest.set(pago.personaId, pago);
    }
  }
  return latest;
}

function membershipMaps(membresias: BackendMembresia[]): MembershipMaps {
  const byId = new Map<number, BackendMembresia>();
  const grouped = new Map<number, BackendMembresia[]>();
  for (const membresia of membresias) {
    byId.set(membresia.id, membresia);
    if (membresia.personaId === undefined) continue;
    const list = grouped.get(membresia.personaId) ?? [];
    list.push(membresia);
    grouped.set(membresia.personaId, list);
  }
  const byPersona = new Map<number, BackendMembresia>();
  for (const [personaId, items] of grouped) {
    const selected = selectMembresiaParaPersona(items);
    if (selected) byPersona.set(personaId, selected);
  }
  return { byId, byPersona };
}

async function fetchMedicalRecordIds(
  request: NextRequest,
  personas: BackendPersonaFull[],
): Promise<Set<number>> {
  const query = personas.map((persona) => `persona_ids=${persona.id}`).join("&");
  const result = await backendFetchAuthed(request, `/fichas-medicas/existe?${query}`);
  if (!result.ok || !result.response.ok) return new Set();
  const body = (await result.response.json()) as { personaIdsConFicha?: number[] };
  return new Set(body.personaIdsConFicha ?? []);
}

async function fetchDebtByMembership(
  request: NextRequest,
  personas: BackendPersonaFull[],
  latest: Map<number, BackendPagoListItem>,
  maps: MembershipMaps,
): Promise<Map<number, DeudaBulkItem>> {
  const ids = new Set<number>();
  for (const persona of personas) {
    const membresia = resolveMembresiaParaPersona(persona.id, latest.get(persona.id), maps.byId, maps.byPersona);
    if (membresia && readsAsVencida(membresia.estado)) ids.add(membresia.id);
  }
  if (!ids.size) return new Map();
  const query = Array.from(ids, (id) => `membresia_ids=${id}`).join("&");
  const result = await backendFetchAuthed(request, `/membresias/deuda/bulk?${query}`);
  if (!result.ok || !result.response.ok) return new Map();
  const items = (await result.response.json()) as BackendDeudaBulkItem[];
  return new Map(items.map((item) => [item.membresiaId, {
    mesesAdeudados: item.mesesAdeudados,
    montoMensual: Number(item.montoMensual),
  }]));
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
   *
   * The two `fetchAllPages` calls are drained page by page because both those
   * tables outgrow the persona table — memberships accumulate per persona
   * over time (vencida, inactiva, la activa) and payments accumulate one row
   * per renewal — so `personasCapped` further down would stay false while a
   * real chunk of either map was already gone. See `lib/server/paged-fetch.ts`
   * for why truncation, not failure, is the hazard those loops exist to
   * prevent, and for what happens when a source outgrows the loop's bound.
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
  const latestPagoByPersona = latestPaymentsByPersona(pagos);

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
  const { byId: membresiaById, byPersona: membresiaByPersona } = membershipMaps(membresias);

  /*
   * A membership can exist with no payment behind it — three personas in the
   * current data hold an ACTIVA membresía and zero Pago rows, so the payment
   * chain above cannot see them at all. This is the fallback
   * `buildMemberStudentSummary` reaches for in that case.
   */

  /*
   * Issue #362: "who has a ficha médica" — a fifth backend call, and
   * necessarily SEQUENTIAL after the `Promise.all` above rather than folded
   * into it, because it needs `personasBody.items` (the persona ids) which
   * only exist once that batch has resolved. It stays a single bulk call —
   * `?persona_ids=1&persona_ids=2&...` — never a per-persona fetch; see
   * members-adapter.ts's module docstring and
   * `backend/app/presentacion/routers/ficha_medica_router.py` for why a
   * per-row loop here would reintroduce the exact N+1 this route's other
   * four sources were rewritten to avoid.
   *
   * Best-effort, same fallback shape as `membresiasDegraded`/`pagosFetch.ok`
   * above: a failed lookup degrades to "nobody has a ficha médica" rather
   * than failing the whole page.
   */
  const personaIdsConFicha = await fetchMedicalRecordIds(request, personasBody.items);

  /*
   * Issue #326: overdue amount + months for the memberships the admin reads
   * as vencidas, one bulk `?membresia_ids=1&membresia_ids=2` call — same
   * shape as the ficha-médica lookup right above.
   *
   * Issue #713: "reads as vencida" is `readsAsVencida`, not `=== "VENCIDA"`.
   * `MEMBERSHIP_STATUS_BY_ESTADO` folds INACTIVA into the same `"vencida"`
   * the screen sees, so gating this fetch on the backend enum alone skipped
   * every never-paid membership — and `StudentMembershipActions`, which can
   * only see `"vencida"`, then rendered "Estado de deuda no disponible" for
   * a debt the backend was answering. The set is still derived through
   * `resolveMembresiaParaPersona`, the SAME resolution `buildMemberAccounts`
   * uses per row, so this only ever queries ids that are actually about to
   * be displayed (never every historical VENCIDA row a persona has
   * accumulated) — and stays bounded by `PERSONAS_PAGE_LIMIT` (200), the
   * backend's own per-request cap on this endpoint.
   *
   * Best-effort, same fallback shape as `fichasFetch` above: a failed or
   * empty lookup degrades to "no debt figures shown" on those rows rather
   * than failing the whole page — never fetched at all when nobody is
   * VENCIDA, so the common case adds zero extra backend calls.
   */
  const deudaByMembresiaId = await fetchDebtByMembership(
    request,
    personasBody.items,
    latestPagoByPersona,
    { byId: membresiaById, byPersona: membresiaByPersona },
  );

  const accounts = buildMemberAccounts(
    personasBody.items,
    latestPagoByPersona,
    membresiaById,
    membresiaByPersona,
    new Map(tipos.map((tipo) => [tipo.id, tipo])),
    personaIdsConFicha,
    deudaByMembresiaId,
  );

  const personasCapped = personasBody.total >= PERSONAS_PAGE_LIMIT;
  const response = NextResponse.json({ accounts, personasCapped, membresiasDegraded });
  if (personasResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: personasResult.refreshedAccessToken });
  }
  return response;
}
