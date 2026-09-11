/**
 * Pure utility functions and mock data for the Gestionar Miembros admin page.
 *
 * Extracted from page.tsx for testability — no React dependencies.
 * Follows the same pattern as attendance-utils.ts and proof-utils.ts.
 */

import type {
  TipoMembresia,
  EstadoMembresia,
  BackendTipoRol,
} from "@/types/domain";
import type { BackendEstadoMembresia } from "@/lib/membership-status";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle state of a payment — mirrors the domain union from Pago.estado. */
export type PaymentStatus =
  | "pendiente_validacion"
  | "aprobado"
  | "rechazado";

/**
 * Account-owner roles that can appear in the members list — a narrow subset
 * of `UserRole` (admin/trainer never own a member row here), so the compiler
 * rejects any value `PAYER_TYPE_LABELS` doesn't have a label for.
 */
export type PayerType = "representante" | "estudiante";

/** A student summary visible in the admin members list. */
export interface MemberStudentSummary {
  id: string;
  nombres: string;
  apellidos: string;
  /**
   * Optional: `PersonaResponseDTO` (backend) has no `email` field — email
   * lives on `Usuario` (login credentials), and there is no bulk endpoint
   * to resolve it per Persona. Omitted (not fabricated) when unavailable.
   */
  email?: string;
  /**
   * Issue #460: `POST /personas/{representanteId}/vincular-representado`
   * identifies the person being linked by CÉDULA, not by id (see
   * `LinkRepresentativeSection.tsx`) — this is the one field the admin
   * panel's "link a representative" action needs off the student it is
   * already editing. Optional/omitted, same convention as every other
   * best-effort field on this type, for a backend or fixture that doesn't
   * carry it.
   */
  cedula?: string;
  telefono?: string;
  fechaNacimiento?: string;
  activo: boolean;
  membresia: {
    /**
     * Display label for the membership plan. Was `TipoMembresia` (a strict
     * "mensual"|"trimestral"|"semestral"|"anual" union) — the real backend
     * `TipoMembresia` model has no such field (only `categoria` free text +
     * `modalidad`: "PERSONALIZADA"|"MENSUAL"), so this is now a plain
     * display string built server-side (see members-adapter.ts) instead of
     * guessing a mapping into the old union. Mock fixtures still use the
     * old literal values ("mensual", etc.) — those remain valid strings.
     */
    tipo: string;
    estado: EstadoMembresia;
    fechaInicio: string;
    fechaFin: string;
    monto: number;
    /** Backend `Membresia.id` — surfaced here so the admin can register
     *  a new payment (renewal) against the right membership. */
    id: number;
    /**
     * Issue #1132: the RAW backend `estado`, before `MEMBERSHIP_STATUS_BY_
     * ESTADO` folds INACTIVA into the same `"vencida"` bucket as VENCIDA
     * (`estado` above). `isOperationalStudent` needs this distinction —
     * "mientras el pago esté pendiente o rechazado, permanece fuera del
     * listado deportivo" only applies to INACTIVA — while every OTHER
     * consumer of `estado` keeps reading the folded, display-facing value.
     * Optional so existing fixtures/tests that don't care about this
     * distinction can omit it; a missing value reads as "not INACTIVA"
     * (operational), the same population `isOperationalStudent` already
     * counted before this field existed.
     */
    estadoBackend?: BackendEstadoMembresia;
    /**
     * `Membresia.es_gratuidad_familiar` — the authoritative gratuity
     * signal; `monto === 0` alone is NOT gratuity (see `BackendMembresia`'s
     * doc comment in payments-adapter.ts). Since issue #400 slice 4c-b,
     * `monto` stays the real tariff even when this is `true` (E04-RF002
     * stopped zeroing it), and `RegisterPaymentForm` reads this flag to
     * block registering a real charge against a gratuitous membership.
     * Optional so the ~existing hand-built fixtures across the admin test
     * suite keep type-checking; the adapter normalizes it to `false` when
     * the backend omits it.
     */
    esGratuidadFamiliar?: boolean;
    /**
     * Issue #326: derived overdue months for a VENCIDA membership, from the
     * bulk debt endpoint (`GET /membresias/deuda/bulk`, admin-only) resolved
     * server-side in `src/app/api/members/route.ts`. Optional and omitted
     * (never fabricated as zero) when the membership isn't `"vencida"` or
     * the bulk lookup didn't resolve it (best-effort, same degrade as
     * `sinDatosEmergencia`'s ficha-médica lookup).
     */
    mesesAdeudados?: number;
    /**
     * `mesesAdeudados * montoMensual` — pure presentation arithmetic done in
     * `members-adapter.ts` on two numbers the backend already computed
     * (never a reimplementation of the day-15/16 debt formula, which stays
     * backend-only). Same optionality/omission rule as `mesesAdeudados`.
     */
    montoAdeudado?: number;
  } | null;
  ultimoPago: {
    estado: PaymentStatus;
    fechaPago: string;
    monto: number;
    periodo: string;
  } | null;
}

/**
 * One row per PERSON (issue #388) — not one row per paying root with the
 * people they represent nested inside. `estudiantes` is always a
 * single-element array holding this exact person's own summary; it stays an
 * array (rather than a scalar field) because `buildMemberStudentSummary`
 * (`lib/server/members-adapter.ts`) already returns `MemberStudentSummary`
 * and every consumer here (`buildMemberStats`, `getAccountStatusBadge`,
 * `accountMatchesFlag`, …) already reduces over "this account's students" —
 * reusing that shape on a 1-element array cost nothing and avoided touching
 * every one of those call sites.
 */
export interface MemberAccount {
  id: string;
  role: PayerType;
  nombres: string;
  apellidos: string;
  /** Optional — see `MemberStudentSummary.email`'s doc comment for why. */
  email?: string;
  telefono: string;
  estudiantes: MemberStudentSummary[];
  /**
   * The full name of this person's representative — `undefined` when they
   * manage their own account (a root persona with no `representanteId`).
   * Read directly off `Persona.representanteId` in `members-adapter.ts`,
   * never guessed.
   */
  representadoPor?: string;
  /**
   * #1133: the numeric `persona.id` behind `representadoPor` — the string
   * above is for display, this is what `reasignar-representante` needs as
   * `representante_actual_id` (the stale-state guard the atomic command
   * checks before replacing the link). `undefined` in lockstep with
   * `representadoPor`: both come from the same `persona.representanteId`
   * lookup in `members-adapter.ts`.
   */
  representadoPorId?: number;
  /**
   * Issue #362: this person has no legal representative at all
   * (`representanteId === null`) AND no ficha médica on file. Optional (not
   * required) for the same reason `representadoPor` is — fixtures and tests
   * that don't exercise the emergency-data gap can omit it and it reads as
   * falsy, same as a persona the adapter never flagged.
   */
  sinDatosEmergencia?: boolean;
  /**
   * Issue #869: whether this Persona's `Usuario` (login credentials) is
   * active — the SAME flag `AuthServicio.login` checks, never inferred from
   * `Persona.activo` (the student panel's own "Estado" badge) nor from
   * `Membresía`. `"none"` is "sin Usuario" (a represented minor with no
   * login of their own). Optional, same omit-rather-than-invent convention
   * as `sinDatosEmergencia` above — `getAccountStateBadge` reads a missing
   * value as `"none"` rather than fabricating "active".
   */
  accountState?: AccountState;
  /**
   * Issue #1132 (gap #1 in `members-adapter.ts`'s module doc): this
   * person's REAL backend roles, from `GET /personas/roles/bulk` — never a
   * guess. Optional/omitted (not fabricated as an empty array) when the
   * bulk lookup didn't resolve this persona (no `Usuario`, or a failed
   * fetch), same convention as every other best-effort field here.
   * `accountDisplayRoles` below is what `IdentityCell` actually renders —
   * it folds in the membership-derived "jugador" signal this field alone
   * cannot carry (a representative with an own active membership keeps
   * ONLY `REPRESENTANTE` here, per the #1132 contract).
   */
  backendRoles?: BackendTipoRol[];
}

/**
 * Account-login state — `Usuario.activo`, independent of `MemberAccount.
 * estudiantes[].activo` (`Persona.activo`, club membership) and of
 * `Membresía`. `"none"` is the persona has no `Usuario` at all.
 */
export type AccountState = "active" | "inactive" | "none";

/** Aggregate statistics for the members overview. */
export interface MemberStats {
  totalAccounts: number;
  totalStudents: number;
  activeMemberships: number;
  pendingPayments: number;
  /** Issue #362: count of accounts with `sinDatosEmergencia: true`. */
  sinDatosEmergencia: number;
}

/** Maximum number of records returned by the upstream member aggregate. */
export const MEMBERS_AGGREGATE_LIMIT = 200;

// Mock data has moved to src/mocks/members.ts.
// Import MOCK_MEMBER_ACCOUNTS from @/mocks/members.

// ---------------------------------------------------------------------------
// Configuration maps
// ---------------------------------------------------------------------------

export const MEMBERSHIP_STATUS_LABELS: Record<EstadoMembresia, string> = {
  activa: "Activa",
  vencida: "Vencida",
  suspendida: "Suspendida",
};

/**
 * `Badge` tone per membership state.
 *
 * Was a map of `.badge-*` class names — one of the four badge vocabularies the
 * audit found. Callers now pass the tone to the `Badge` primitive instead of
 * splicing a class string into a `<span>`, so every status pill in the product
 * has one shape and one colour source.
 */
export const MEMBERSHIP_STATUS_TONE: Record<EstadoMembresia, BadgeTone> = {
  activa: "ok",
  vencida: "bad",
  suspendida: "bad",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  aprobado: "Aprobado",
  pendiente_validacion: "Pendiente",
  rechazado: "Rechazado",
};

/**
 * `Cuenta` badge spec (issue #869): label + tone per `AccountState`, the
 * same pairing convention as `MEMBERSHIP_STATUS_TONE` above. Three states,
 * three DIFFERENT words — "Activa" / "Inactiva" / "Sin cuenta" carry the
 * distinction in the text itself, not only in `tone`, so the badge reads
 * without colour. `inactive` reuses the tone `MemberEditDialog`'s own
 * estado toggle already assigns a deactivated account (`bad`) — a login
 * that was deliberately switched off, unlike `suspendida`.
 */
export const ACCOUNT_STATE_LABELS: Record<AccountState, string> = {
  active: "Activa",
  inactive: "Inactiva",
  none: "Sin cuenta",
};

export const ACCOUNT_STATE_TONE: Record<AccountState, BadgeTone> = {
  active: "ok",
  inactive: "bad",
  none: "neutral",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  aprobado: "ok",
  pendiente_validacion: "warn",
  rechazado: "bad",
};

export const PAYER_TYPE_LABELS: Record<PayerType, string> = {
  representante: "Representante",
  estudiante: "Estudiante",
};

export const MEMBERSHIP_TYPE_LABELS: Record<TipoMembresia, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

import type { BadgeTone } from "@/components/ui/Badge";

export { formatCurrency, formatDate } from "@/lib/format-utils";
import { formatDateRange } from "@/lib/format-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a date string, handling date-only values ("YYYY-MM-DD") as stable
 * calendar dates instead of UTC midnight.
 *
 * Returns `null` for invalid or empty inputs.
 */
function parseDateStringLocal(dateStr: string): Date | null {
  if (!dateStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
    return d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Issue #1132: "es jugador" is a fact about the MEMBERSHIP, never about
 * `Persona.activo` — a pure representative's own row carries a
 * `MemberStudentSummary` with `membresia: null` (`members-adapter.ts` never
 * resolved one because none exists), and that absence, not `activo`, is what
 * says this person has never been a player. `activo` stays a real, separate
 * fact (an administratively archived Persona) that no longer decides this
 * question — a lapsed (vencida) or suspended member is still counted here:
 * they HAVE a membership on file, just not a current one, and the roster
 * (and its debt tracking, issue #326) still needs to show them.
 *
 * A membership whose FIRST payment is still pending or was rejected
 * (backend INACTIVA) stays OUT, per the owner's final contract: "mientras
 * el pago esté pendiente o rechazado, permanece fuera del listado
 * deportivo." `estado` (the display-facing field) cannot tell INACTIVA
 * apart from a real VENCIDA — both fold into `"vencida"` — so this reads
 * `membresia.estadoBackend`, the one field that still carries the raw
 * backend enum. ACTIVA, VENCIDA and SUSPENDIDA all stay counted.
 */
function isOperationalStudent(student: MemberAccount["estudiantes"][number]): boolean {
  return student.membresia !== null && student.membresia.estadoBackend !== "INACTIVA";
}

/**
 * Whether this row's own Persona is an archived (`activo: false`) account —
 * independent of whether it is, or has ever been, a player. Issue #362's
 * "sin datos de emergencia" gap is about THIS Persona having no one to call
 * (no representative and no ficha médica), which applies just as much to a
 * pure representative as to a player, so it deliberately does NOT filter on
 * `isOperationalStudent` (membership) — a representative with no membership
 * on file is exactly the account this stat exists to catch.
 */
function isActiveAccountHolder(student: MemberAccount["estudiantes"][number]): boolean {
  return student.activo;
}

function hasOperationalStudent(account: MemberAccount): boolean {
  return account.estudiantes.length === 0 || account.estudiantes.some(isActiveAccountHolder);
}

function isPendingOperationalPayment(student: MemberAccount["estudiantes"][number]): boolean {
  return student.membresia?.estado !== "suspendida" && student.ultimoPago?.estado === "pendiente_validacion";
}

/**
 * Build aggregate statistics from the member accounts list.
 */
export function buildMemberStats(accounts: MemberAccount[]): MemberStats {
  const operationalStudents = accounts.flatMap((account) => account.estudiantes).filter(isOperationalStudent);
  return {
    totalAccounts: accounts.length,
    totalStudents: operationalStudents.length,
    activeMemberships: operationalStudents.filter((student) => student.membresia?.estado === "activa").length,
    pendingPayments: operationalStudents.filter(isPendingOperationalPayment).length,
    sinDatosEmergencia: accounts.filter(
      (account) => account.sinDatosEmergencia && hasOperationalStudent(account),
    ).length,
  };
}

/**
 * Build a summary string for a student's membership period.
 *
 * Delegates to the shared `formatDateRange`: this used to render "1 jul — 12
 * ago 2026", a month-name grammar that appeared nowhere else and that an admin
 * had to mentally convert before comparing it to the dd/mm/yyyy dates on
 * `/payments`. Both ends now carry the year, so a period spanning a year
 * boundary is unambiguous.
 *
 * Requires BOTH ends — a membership with one open end is not a period, so it
 * returns an empty string rather than a half-rendered range.
 */
export function formatMembershipPeriod(
  fechaInicio: string,
  fechaFin: string,
): string {
  if (!parseDateStringLocal(fechaInicio) || !parseDateStringLocal(fechaFin)) return "";
  return formatDateRange(fechaInicio, fechaFin);
}

/**
 * Get the full display name for an account owner's role.
 */
export function getPayerTypeLabel(role: PayerType): string {
  return PAYER_TYPE_LABELS[role];
}

/**
 * Normalize text for accent-insensitive comparison.
 *
 * Strips diacritic accent marks via NFD decomposition, lowercases the
 * result, and trims leading/trailing whitespace. This allows "Martinez"
 * to match "Martínez", "Perez" to match "Pérez", etc.
 *
 * Preserves the letter ñ (U+00F1) — it is a distinct Spanish letter, not an
 * accented n. The combining tilde (U+0303) is NOT removed.
 */
export function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, (char) => (char === "\u0303" ? char : ""))
    .normalize("NFC");
}

/**
 * Filter member accounts by a search term.
 *
 * Matches against the person's own full name, email, their own student
 * summary name (kept for symmetry — `estudiantes` is always this same
 * person), and — issue #388 — their representative's full name
 * (`representadoPor`). That last check matters because a represented person
 * is now their own row rather than nested under their representative's: an
 * admin who types the representative's name still has to find the people
 * that representative pays for.
 * Uses accent-insensitive comparison — "Martinez" matches "Martínez".
 * Returns a shallow copy of the input array when the search term is empty or blank.
 */
export function filterAccounts(
  accounts: MemberAccount[],
  searchTerm: string,
): MemberAccount[] {
  const term = normalizeText(searchTerm.trim());
  if (!term) return [...accounts];

  return accounts.filter((account) => {
    if (normalizeText(`${account.nombres} ${account.apellidos}`).includes(term)) {
      return true;
    }
    if (account.email && normalizeText(account.email).includes(term)) {
      return true;
    }
    if (normalizeText(account.representadoPor ?? "").includes(term)) {
      return true;
    }
    return account.estudiantes.some((a) =>
      normalizeText(`${a.nombres} ${a.apellidos}`).includes(term),
    );
  });
}

/**
 * Quick-filter chips shown above the members table
 * (design/admin-members-mockup-v1.html's `.chip-filters`).
 */
export type MemberFilterFlag = "all" | "vencida" | "pendiente" | "sin-emergencia";

/**
 * Does this account have at least one student matching the given filter
 * flag? "all" always matches. Used alongside `filterAccounts` (text
 * search) — the two compose, they don't replace each other.
 */
export function accountMatchesFlag(
  account: MemberAccount,
  flag: MemberFilterFlag,
): boolean {
  switch (flag) {
    case "all":
      return true;
    case "vencida":
      return account.estudiantes.some((s) => s.activo && s.membresia?.estado === "vencida");
    case "pendiente":
      return account.estudiantes.some((s) =>
        s.activo && s.membresia?.estado !== "suspendida" && s.ultimoPago?.estado === "pendiente_validacion",
      );
    /*
     * Issue #730. Reads the SAME field the "Sin datos de emergencia" stat
     * tile counts (`buildMemberStats`), so the tile and the chip can never
     * report different populations — the number on the tile IS the list this
     * returns. Writing a second predicate here (e.g. re-deriving "no
     * representative and no ficha") would have been a copy of the adapter's
     * rule that could drift from it silently.
     *
     * `=== true`, not a truthy read: the flag is optional and the adapter
     * omits it rather than fabricating it when the bulk ficha lookup didn't
     * resolve. `undefined` means "we don't know", and an unknown must not
     * land on a worklist of people to go chase.
     */
    case "sin-emergencia":
      return hasOperationalStudent(account) && account.sinDatosEmergencia === true;
  }
}

/**
 * Count accounts matching a filter flag — powers the chip's count badge.
 */
export function countAccountsMatchingFlag(
  accounts: MemberAccount[],
  flag: MemberFilterFlag,
): number {
  return accounts.filter((account) => accountMatchesFlag(account, flag)).length;
}

/**
 * Count the number of students with active membership for a given account.
 */
export function countActiveStudents(account: MemberAccount): number {
  return account.estudiantes.filter(
    (a) => a.membresia?.estado === "activa",
  ).length;
}

/**
 * Issue #1132: the role labels `IdentityCell` actually renders for this
 * row — `account.backendRoles` (the real roles, issue #1132's bulk
 * lookup), plus `"ALUMNO"` when the person is a player right now (an OWN
 * `ACTIVA` membership) and that role isn't already among them.
 *
 * "Jugador" cannot come from `backendRoles` alone: the #1132 contract keeps
 * a self-enrolled representative on EXACTLY `REPRESENTANTE`, never adding
 * `ALUMNO` — "ser jugador" is a fact about the membership, not the role
 * (same rule `isOperationalStudent` enforces above, narrowed here to
 * `"activa"` specifically, per the owner's "la condición de jugador se
 * deriva EXCLUSIVAMENTE de una membresía ACTIVA"). Reusing the `ALUMNO`
 * key (rather than inventing a new one) is deliberate: `IdentityCell`'s own
 * map already spells that key "Jugador", the exact word this needs, and an
 * adult self-student who really does hold the `ALUMNO` role already reaches
 * this word through `backendRoles` with no synthesis at all.
 */
export function accountDisplayRoles(account: MemberAccount): BackendTipoRol[] {
  const roles = account.backendRoles ?? [];
  if (countActiveStudents(account) === 0 || roles.includes("ALUMNO")) return roles;
  return [...roles, "ALUMNO"];
}

/**
 * Get the account status badge label and variant for the members table.
 *
 * Returns a label plus the `Badge` tone that carries it:
 *  - "Activo" / ok — at least one student has an active membership.
 *  - "Pago pendiente de validación" / warn — no active memberships but a
 *    payment is awaiting review.
 *  - the specific failure / bad — otherwise.
 */
export function getAccountStatusBadge(account: MemberAccount): {
  label: string;
  tone: BadgeTone;
} {
  const activeCount = countActiveStudents(account);
  if (activeCount > 0) {
    return { label: "Activo", tone: "ok" };
  }
  // Un pago pendiente de validación es la situación más accionable: mostrar
  // eso primero aunque la membresía esté vencida/suspendida.
  if (
    account.estudiantes.some(
      (a) => a.ultimoPago?.estado === "pendiente_validacion",
    )
  ) {
    return { label: "Pago pendiente de validación", tone: "warn" };
  }
  if (account.estudiantes.some((a) => a.membresia?.estado === "vencida")) {
    return { label: "Membresía vencida", tone: "bad" };
  }
  if (account.estudiantes.some((a) => a.membresia?.estado === "suspendida")) {
    return { label: "Cuenta suspendida", tone: "bad" };
  }
  // Neutral, never `bad`. Red is reserved for the primary CTA and for
  // errors/destructive states (`docs/archive/prototypes/plan-implementacion-rediseno.md`,
  // "Concepto y reglas duras" §3 and §5). "Sin membresía" is the state every
  // freshly registered account is in; a red badge told 29 of 44 accounts they
  // were broken when nothing had gone wrong.
  return { label: "Sin membresía", tone: "neutral" };
}

/**
 * Get the `Cuenta` badge label and tone for an account (issue #869) —
 * `getAccountStatusBadge`'s sibling, over `AccountState` instead of
 * `Membresía`. `account.accountState` missing reads as `"none"` ("sin
 * cuenta"), never as `"active"` — same omit-rather-than-invent convention as
 * every other optional flag on `MemberAccount`.
 */
export function getAccountStateBadge(account: MemberAccount): {
  label: string;
  tone: BadgeTone;
} {
  const state = account.accountState ?? "none";
  return { label: ACCOUNT_STATE_LABELS[state], tone: ACCOUNT_STATE_TONE[state] };
}

// ---------------------------------------------------------------------------
// Pagination (client-side, mirrors attendance-utils.ts's paginateRecords/getTotalPages)
// ---------------------------------------------------------------------------

/** Accounts per page for the members table. */
export const MEMBERS_PAGE_SIZE = 10;

/**
 * Slice a (possibly already filtered) accounts list to a single page.
 *
 * `page` is 1-indexed. Returns an empty array when `page` is beyond the
 * available data — never throws or wraps around.
 */
export function paginateAccounts(
  accounts: MemberAccount[],
  page: number,
  pageSize: number = MEMBERS_PAGE_SIZE,
): MemberAccount[] {
  const start = (page - 1) * pageSize;
  return accounts.slice(start, start + pageSize);
}

/**
 * Total number of pages for a given account count.
 *
 * Always returns at least 1 (never 0 pages, even for an empty list) so
 * "Página 1 de 1" is a valid state to render.
 */
export function getTotalPages(
  totalAccounts: number,
  pageSize: number = MEMBERS_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalAccounts / pageSize));
}
