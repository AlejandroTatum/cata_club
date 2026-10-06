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
import {
  fetchDebtByMembership,
  fetchMedicalRecordIds,
  fetchRolesByPersonaId,
  latestPaymentsByPersona,
  membershipMaps,
} from "@/lib/server/members-lookups";
import { fetchAllPages } from "@/lib/server/paged-fetch";
import type { BackendMembresia, BackendPagoListItem, BackendTipoMembresia } from "@/lib/server/payments-adapter";

const PERSONAS_PAGE_LIMIT = 200;
const MEMBRESIAS_PAGE_LIMIT = 200;
const PAGOS_PAGE_LIMIT = 200;

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
   * The three `fetchAllPages` calls are drained page by page: personas (QA3
   * ADM-03: a single capped page left everyone past row 200 unreachable) and
   * the two tables that outgrow it — memberships accumulate per persona over
   * time (vencida, inactiva, la activa) and payments accumulate one row per
   * renewal. See `lib/server/paged-fetch.ts`
   * for why truncation, not failure, is the hazard those loops exist to
   * prevent, and for what happens when a source outgrows the loop's bound.
   */
  const [personasFetch, pagosFetch, tiposResult, membresiasFetch] = await Promise.all([
    fetchAllPages<BackendPersonaFull>(request, "/personas/", PERSONAS_PAGE_LIMIT),
    fetchAllPages<BackendPagoListItem>(request, "/membresias/pagos", PAGOS_PAGE_LIMIT),
    backendFetchAuthed(request, "/membresias/tipos"),
    fetchAllPages<BackendMembresia>(request, "/membresias/", MEMBRESIAS_PAGE_LIMIT),
  ]);

  // Every persona or none (QA3 ADM-03): `fetchAllPages` never hands back a
  // prefix, so a failure here keeps the backend's own status when it has one
  // and is a 502 when the drain only ran out of its page bound.
  if (!personasFetch.ok) {
    const failure = personasFetch.failure;
    if (failure && !failure.ok) {
      return NextResponse.json({ message: "No se pudieron cargar las personas." }, { status: failure.status });
    }
    if (failure) {
      return passthroughBackendError(failure.response, "No se pudieron cargar las personas.");
    }
    return NextResponse.json({ message: "No se pudieron cargar las personas." }, { status: 502 });
  }
  const personasBody = { items: personasFetch.items };

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
   * Issue #1132: "who has which roles" — closes gap #1 in
   * `members-adapter.ts`'s module doc (a hardcoded `role: "representante"`
   * on every row). Same one-bulk-call, sequential-after-`personasBody`,
   * best-effort shape as the ficha-médica lookup right above.
   */
  const rolesByPersonaId = await fetchRolesByPersonaId(request, personasBody.items);

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
   * accumulated) — and goes out in chunks of `BULK_IDS_LIMIT` (200), the
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
    rolesByPersonaId,
  );

  const response = NextResponse.json({ accounts, membresiasDegraded });
  if (personasFetch.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: personasFetch.refreshedAccessToken });
  }
  return response;
}
