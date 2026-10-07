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
import { inactivaMembershipBadge, type BackendEstadoMembresia } from "@/lib/membership-status";
import type { Periodicidad } from "@/lib/tarifa-periodo";

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
    /** Period of the LAST payment (pending, rejected or retroactive included).
     *  NOT the membership's coverage — "Vigencia" reads `cubiertoHasta`. */
    fechaInicio: string;
    fechaFin: string;
    /**
     * Real coverage end of the membership (`Membresia.cubierto_hasta`: the
     * latest end across approved payments and bonified coverage), `null` when
     * nothing was ever covered (QA3 ADM-14). Optional so fixtures and an
     * older backend that omits it read as "no coverage".
     */
    cubiertoHasta?: string | null;
    monto: number;
    /** The tariff's period (MENSUAL/SEMANAL/DIARIA); absent = MENSUAL. */
    periodicidad?: Periodicidad;
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
    /** End of the last approved coverage (ISO date), or null if never covered. ADMA-24. */
    deudaDesde?: string | null;
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
  /**
   * Issue #1221: the personas whose `representanteId` equals THIS persona's
   * id — never this persona's own `estudiantes[0]`. `members-adapter.ts#
   * buildMemberAccounts` groups the SAME `/personas/` payload by
   * `representanteId` (no extra request per row), reusing each dependent's
   * own already-built `MemberStudentSummary` (the summary that persona's own
   * row also carries). Optional/omitted (never fabricated) for a represented
   * minor, a self-managed adult with no representados, and any fixture built
   * before this field existed — the "Estudiantes a cargo" section in
   * page.tsx reads a missing value as "no dependents" and hides the section.
   */
  dependientes?: MemberStudentSummary[];
}

/**
 * Account-login state — `Usuario.activo`, independent of `MemberAccount.
 * estudiantes[].activo` (`Persona.activo`, club membership) and of
 * `Membresía`. `"none"` is the persona has no `Usuario` at all.
 */
export type AccountState = "active" | "inactive" | "none" | "invitation";

/** Aggregate statistics for the members overview. */
export interface MemberStats {
  totalAccounts: number;
  totalStudents: number;
  activeMemberships: number;
  pendingPayments: number;
  /** Issue #362: count of accounts with `sinDatosEmergencia: true`. */
  sinDatosEmergencia: number;
}

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
  // Issue #1575: a trainer the admin created who has not set a password yet.
  invitation: "Invitación pendiente",
};

export const ACCOUNT_STATE_TONE: Record<AccountState, BadgeTone> = {
  active: "ok",
  inactive: "bad",
  none: "neutral",
  invitation: "warn",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  aprobado: "ok",
  pendiente_validacion: "warn",
  rechazado: "bad",
};

export const PAYER_TYPE_LABELS: Record<PayerType, string> = {
  representante: "Representante",
  estudiante: "Jugador",
};

export const MEMBERSHIP_TYPE_LABELS: Record<TipoMembresia, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

import type { BadgeTone } from "@/components/ui/Badge";

export { formatCurrency, formatDate } from "@/lib/format-utils";
import { formatCurrency, formatDate, formatDateRange } from "@/lib/format-utils";

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

/**
 * Whether this student has a payment currently awaiting admin validation —
 * the "por validar" definition shared by the KPI tile (`buildMemberStats`)
 * and the "Pago pendiente" filter chip (`accountMatchesFlag`).
 *
 * Issue #1199: the two used to diverge — the KPI additionally filtered
 * through `isOperationalStudent` (which excludes backend INACTIVA), so a
 * just-created membership's very FIRST payment never counted toward "por
 * validar" even though it is the textbook case of a payment waiting on the
 * admin; the chip, which never applied that filter, counted it. `activo` is
 * the same account-holder guard the chip already applied; `suspendida` stays
 * excluded because a suspended membership does not accrue new dues to
 * validate.
 */
function hasPaymentAwaitingValidation(student: MemberAccount["estudiantes"][number]): boolean {
  return (
    student.activo &&
    student.membresia?.estado !== "suspendida" &&
    student.ultimoPago?.estado === "pendiente_validacion"
  );
}

/**
 * Build aggregate statistics from the member accounts list.
 */
export function buildMemberStats(accounts: MemberAccount[]): MemberStats {
  const allStudents = accounts.flatMap((account) => account.estudiantes);
  const operationalStudents = allStudents.filter(isOperationalStudent);
  return {
    totalAccounts: accounts.length,
    totalStudents: operationalStudents.length,
    activeMemberships: operationalStudents.filter((student) => student.membresia?.estado === "activa").length,
    // Not filtered through `operationalStudents`: see `hasPaymentAwaitingValidation`'s doc comment.
    pendingPayments: allStudents.filter(hasPaymentAwaitingValidation).length,
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
 * "Vigencia" of a membership: the end of its REAL coverage (QA3 ADM-14), e.g.
 * "Hasta 01/12/2026". Empty when nothing was ever covered, so the caller
 * renders a dash rather than an invented range.
 */
export function formatMembershipCoverage(cubiertoHasta: string | null | undefined): string {
  if (!cubiertoHasta || !parseDateStringLocal(cubiertoHasta)) return "";
  return `Hasta ${formatDate(cubiertoHasta)}`;
}

/**
 * Get the full display name for an account owner's role.
 */
export function getPayerTypeLabel(role: PayerType): string {
  return PAYER_TYPE_LABELS[role];
}

/**
 * Role caption for a person's dialog header (QA3 ADM-20). `account.role`
 * defaults to "representante" for anyone the roles lookup did not resolve, so
 * a person with no role at all used to read "Representante". With no real
 * backend role and nobody they represent, say so instead of guessing.
 */
export function getAccountRoleLabel(
  account: MemberAccount,
  roles: BackendTipoRol[] | undefined = account.backendRoles,
): string {
  // ADMA-06: an account holds one role, and an admin or trainer must not read
  // as «Representante» just because `account.role` defaults to it.
  if (roles?.includes("ADMINISTRADOR")) return "Administrador";
  if (roles?.includes("ENTRENADOR")) return "Entrenador";
  const hasRole = (roles?.length ?? 0) > 0;
  const representsSomeone = (account.dependientes?.length ?? 0) > 0;
  if (account.role === "representante" && !hasRole && !representsSomeone) {
    return "Sin rol asignado";
  }
  return getPayerTypeLabel(account.role);
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
  const words = normalizeText(searchTerm).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...accounts];

  // ADMA-02: every word must appear, in any order — "Alexander Vera" finds
  // "Alexander Alcivar Vera". Each searchable field is checked on its own so
  // words never match across unrelated fields.
  const matches = (field: string | undefined) => {
    if (!field) return false;
    const text = normalizeText(field);
    return words.every((word) => text.includes(word));
  };

  return accounts.filter((account) => {
    if (matches(`${account.nombres} ${account.apellidos}`)) return true;
    if (matches(account.email)) return true;
    if (matches(account.representadoPor)) return true;
    // ADMA-01: cédula, complete or partial. It lives on the person's own summary.
    return account.estudiantes.some(
      (a) => matches(`${a.nombres} ${a.apellidos}`) || matches(a.cedula),
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
      // Issue #1199: `estado === "vencida"` alone also matches a just-created
      // backend INACTIVA membership (`MEMBERSHIP_STATUS_BY_ESTADO` folds it
      // into the same bucket as a real VENCIDA — see membership-status.ts).
      // `estadoBackend` is the one field that still carries the raw enum;
      // excluding INACTIVA here keeps this chip counting only memberships
      // that were once current and lapsed, never one that never activated.
      return account.estudiantes.some(
        (s) => s.activo && s.membresia?.estado === "vencida" && s.membresia.estadoBackend !== "INACTIVA",
      );
    case "pendiente":
      return account.estudiantes.some(hasPaymentAwaitingValidation);
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
 * The members list's role filter. «Jugador» is the list's own notion
 * (`accountDisplayRoles`: the ALUMNO role or an own ACTIVA membership), so the
 * filter and the role badge on each row can never disagree.
 */
export type MemberRoleFilter = "jugador" | "admin" | "entrenador" | "representante" | "todos";

export const MEMBER_ROLE_FILTER_OPTIONS: { value: MemberRoleFilter; label: string }[] = [
  { value: "jugador", label: "Jugador" },
  { value: "admin", label: "Admin" },
  { value: "entrenador", label: "Entrenador" },
  { value: "representante", label: "Representante" },
  { value: "todos", label: "Todos" },
];

/** The list always opens on players. */
export const DEFAULT_MEMBER_ROLE_FILTER: MemberRoleFilter = "jugador";

const ROLE_FILTER_BACKEND_ROLE: Record<Exclude<MemberRoleFilter, "todos">, BackendTipoRol> = {
  jugador: "ALUMNO",
  admin: "ADMINISTRADOR",
  entrenador: "ENTRENADOR",
  representante: "REPRESENTANTE",
};

/**
 * Does the account hold the picked role? A multi-role person matches each of
 * theirs. «Jugador» is the club's player rule (`isPlayerAccount`, owner
 * decision A in #1669) plus a new player whose first payment is still
 * pending (INACTIVA): the admin opens this list precisely to register it
 * (owner, 2026-10-06: "si que aparezca el chico que aun no paga").
 */
export function accountMatchesRole(account: MemberAccount, filter: MemberRoleFilter): boolean {
  if (filter === "todos") return true;
  const shown = accountDisplayRoles(account).includes(ROLE_FILTER_BACKEND_ROLE[filter]);
  if (filter !== "jugador") return shown;
  return (
    shown ||
    isPlayerAccount(account) ||
    account.estudiantes.some((student) => student.membresia?.estadoBackend === "INACTIVA")
  );
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
 * Issues #1661/#1669: is this account a player (someone who can be put in a
 * horario), as opposed to pure staff or a representative?
 *
 * The same rule as the backend horario player search
 * (`GET /personas/buscar?jugador=true`): the ALUMNO role, or an own
 * membership that allows training (ACTIVA or VENCIDA — the backend
 * `puede_entrenar` rule). A represented minor has no `Usuario` and so no
 * role; they count only once their membership allows training, otherwise
 * «Sin grupo» would list someone the horario search cannot find (owner
 * decision A, #1669). Staff and representatives without such a membership
 * are not players.
 */
export function isPlayerAccount(account: MemberAccount): boolean {
  const roles = account.backendRoles ?? [];
  if (roles.includes("ALUMNO")) return true;
  return account.estudiantes.some((student) => {
    const estado = student.membresia?.estadoBackend;
    return estado === "ACTIVA" || estado === "VENCIDA";
  });
}

/**
 * Issue #1670: whether the admin may print this account's carnet — players
 * only (the #1661/#1669 rule via `isPlayerAccount`), and never the
 * representative's own row, which holds no player to put on a card. A
 * represented minor without an account of their own qualifies once their
 * membership allows training.
 */
export function canPrintCarnet(account: MemberAccount): boolean {
  return isPlayerAccount(account) && !isRepresentativePersonaRow(account);
}

/** The admin's carnet printing screen (issue #1670). */
export const CARNETS_PATH = "/members/carnets";

/** The printing screen for these personas; `titulo` names a whole category on the sheet. */
export function carnetsHref(personaIds: readonly (string | number)[], titulo?: string): string {
  const query = new URLSearchParams({ ids: personaIds.join(",") });
  if (titulo) query.set("titulo", titulo);
  return `${CARNETS_PATH}?${query.toString()}`;
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
 * ADMA-24: one line for the «Membresía vencida» list — how much the account
 * owes and since when — from numbers the server already computed. Null when
 * no student has a debt on record.
 */
export function getDebtSummary(account: MemberAccount): string | null {
  const owing = account.estudiantes
    .map((s) => s.membresia)
    .filter((m): m is NonNullable<typeof m> => !!m && (m.mesesAdeudados ?? 0) > 0);
  if (owing.length === 0) return null;
  const meses = owing.reduce((sum, m) => sum + (m.mesesAdeudados ?? 0), 0);
  const monto = owing.reduce((sum, m) => sum + (m.montoAdeudado ?? 0), 0);
  const desde = owing
    .map((m) => m.deudaDesde)
    .filter((d): d is string => !!d)
    .sort()[0];
  const parts = [`Debe ${formatCurrency(monto)}`, `${meses} ${meses === 1 ? "mes" : "meses"}`];
  if (desde) parts.push(`desde ${formatDate(desde)}`);
  return parts.join(" · ");
}

/**
 * Get the account status badge label and variant for the members table.
 *
 * Returns a label plus the `Badge` tone that carries it:
 *  - "Activo" / ok — at least one student has an active membership.
 *  - "Pago pendiente de validación" / warn — no active memberships but a
 *    payment is awaiting review.
 *  - "Sin activar" / neutral — a just-created (backend INACTIVA) membership
 *    with no payment awaiting review (issue #1199).
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
    return { label: "Pago por validar", tone: "warn" };
  }
  // Issue #1199: `MEMBERSHIP_STATUS_BY_ESTADO` folds a just-created backend
  // INACTIVA membership into the same `"vencida"` bucket as a real VENCIDA
  // (see membership-status.ts), so `estado` alone cannot tell them apart —
  // only `estadoBackend`, the raw enum, can. Checked BEFORE the "vencida"
  // branch below so an INACTIVA membership — never active, first payment
  // not (or no longer) awaiting validation — never reads as "vencida".
  if (account.estudiantes.some((a) => a.membresia?.estadoBackend === "INACTIVA")) {
    return { label: "Sin activar", tone: "neutral" };
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
 * Membership status label for a SINGLE student — `StudentEditPanel`'s
 * per-student "Membresía" field, distinct from `getAccountStatusBadge`'s
 * account-level composite above.
 *
 * Issue #1199: a just-created backend INACTIVA membership — never active,
 * first payment still pending or not yet made — used to read the plain
 * `MEMBERSHIP_STATUS_LABELS[estado]` lookup, which is the SAME "Vencida" an
 * actually lapsed membership gets (`MEMBERSHIP_STATUS_BY_ESTADO` folds both
 * into `"vencida"`). This reads `estadoBackend`, the one field that still
 * carries the raw enum, to tell them apart: "Por validar" while a payment
 * is queued for review, "Sin activar" once nothing is — never "Vencida".
 */
export function getMembershipStatusBadge(
  student: Pick<MemberStudentSummary, "membresia" | "ultimoPago">,
): { label: string; tone: BadgeTone } {
  const { membresia } = student;
  if (!membresia) return { label: "Sin membresía", tone: "neutral" };
  if (membresia.estadoBackend === "INACTIVA") {
    return inactivaMembershipBadge(student.ultimoPago?.estado === "pendiente_validacion");
  }
  return { label: MEMBERSHIP_STATUS_LABELS[membresia.estado], tone: MEMBERSHIP_STATUS_TONE[membresia.estado] };
}

/** The one action a payments state leads with (matches the tile `data-primary-action`). */
export type PaymentsPrimaryAction =
  | "tipo-socio"
  | "revisar-pago"
  | "reactivar"
  | "registrar-pago"
  | "regularizar-deuda";

export interface PaymentsState {
  key: "primer-pago" | "pendiente-revision" | "suspendida" | "rechazado" | "debe" | "vencida" | "al-dia";
  /** What the admin reads first, in plain Spanish. */
  label: string;
  tone: BadgeTone;
  /** One sentence: what this means and what to do about it. */
  detail: string;
  primaryAction: PaymentsPrimaryAction;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * The period a payment covers, in words: «octubre 2026» for whole calendar
 * months, «22 ago – 21 sep 2026» for a period that starts mid-month. Reads the
 * ISO date as written (no timezone shift), so a payment never moves a day.
 */
export function describePeriodoPago(fechaInicio: string, fechaFin: string): string {
  const parse = (iso: string): { y: number; m: number; d: number } | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return match ? { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) } : null;
  };
  const a = parse(fechaInicio);
  const b = parse(fechaFin);
  if (!a || !b) return "";
  const lastDay = new Date(Date.UTC(b.y, b.m + 1, 0)).getUTCDate();
  if (a.d === 1 && b.d === lastDay) {
    if (a.y === b.y && a.m === b.m) return `${MESES[a.m]} ${a.y}`;
    return a.y === b.y
      ? `${MESES[a.m]} – ${MESES[b.m]} ${b.y}`
      : `${MESES[a.m]} ${a.y} – ${MESES[b.m]} ${b.y}`;
  }
  const short = (m: number): string => MESES[m].slice(0, 3);
  return a.y === b.y
    ? `${a.d} ${short(a.m)} – ${b.d} ${short(b.m)} ${b.y}`
    : `${a.d} ${short(a.m)} ${a.y} – ${b.d} ${short(b.m)} ${b.y}`;
}

/**
 * Where a member stands on the payments page (#1668), in the words the club
 * uses, and the ONE action that moves them forward. A pure read of the row's
 * own data — same precedence the actions already followed (a first payment
 * and a payment under review outrank everything, then suspension, a rejected
 * payment, debt, and finally "al día").
 */
export function describePaymentsState(
  student: Pick<MemberStudentSummary, "membresia" | "ultimoPago">,
): PaymentsState {
  const { membresia, ultimoPago } = student;
  if (isPrimerPagoPendiente(student as MemberStudentSummary)) {
    return {
      key: "primer-pago",
      label: "Primer pago pendiente",
      tone: "neutral",
      detail: "Todavía no tiene ningún pago. Empieza indicando si es socio nuevo o antiguo.",
      primaryAction: "tipo-socio",
    };
  }
  // Suspension outranks a payment under review: reactivation is what unblocks everything else.
  if (membresia?.estado === "suspendida") {
    return {
      key: "suspendida",
      label: "Membresía suspendida",
      tone: "warn",
      detail:
        ultimoPago?.estado === "pendiente_validacion"
          ? "Reactívala primero: mientras esté suspendida no se pueden registrar pagos. El pago pendiente se revisa en Pagos pendientes."
          : "No se pueden registrar pagos mientras esté suspendida. Reactívala para continuar.",
      primaryAction: "reactivar",
    };
  }
  if (ultimoPago?.estado === "pendiente_validacion") {
    return {
      key: "pendiente-revision",
      label: "Pago pendiente de revisión",
      tone: "warn",
      detail:
        "Hay un pago esperando aprobación. Apruébalo o recházalo aquí; si tiene un error, recházalo y vuelve a registrarlo.",
      primaryAction: "revisar-pago",
    };
  }
  if (ultimoPago?.estado === "rechazado") {
    return {
      key: "rechazado",
      label: "Último pago rechazado",
      tone: "bad",
      detail: "El último pago no fue aprobado. Regístralo de nuevo con los datos correctos.",
      primaryAction: "registrar-pago",
    };
  }
  const meses = membresia?.mesesAdeudados ?? 0;
  if (meses > 0) {
    return {
      key: "debe",
      label: `Debe ${meses} ${meses === 1 ? "mes" : "meses"}`,
      tone: "bad",
      detail: "Registra su pago; si debe varios meses vencidos, cárgalos de una vez para dejarlo al día.",
      primaryAction: "registrar-pago",
    };
  }
  if (membresia?.estado === "vencida") {
    // Lapsed with no whole month owed yet (0), or the bulk debt lookup failed
    // (undefined): either way never claim «Al día» over a lapsed membership.
    return {
      key: "vencida",
      label: "Membresía vencida",
      tone: "bad",
      detail:
        membresia.mesesAdeudados === undefined
          ? "No se pudo calcular cuánto debe. Puedes registrar el pago igualmente."
          : "La cobertura venció y todavía no se completó un mes de deuda. Registra el siguiente pago.",
      primaryAction: "registrar-pago",
    };
  }
  const hasta = formatMembershipCoverage(membresia?.cubiertoHasta);
  return {
    key: "al-dia",
    label: "Al día",
    tone: "ok",
    detail: hasta
      ? `${hasta.replace(/^Hasta/, "Cubierto hasta")}. Registra el siguiente pago cuando llegue el momento.`
      : "No tiene meses pendientes. Registra el siguiente pago cuando llegue el momento.",
    primaryAction: "registrar-pago",
  };
}

/**
 * Whether this row IS the representative/payer's own persona row — the root
 * account that pays for others but has never had a membership of her own on
 * file. Issue #1199: `MedicalRecordAccessButton`/`PaymentsAccessButton` used
 * to render unconditionally, offering student-only actions on a row whose
 * badge already says "Representante" and carries no membership at all.
 *
 * Issue #1211 (regression from #1202/#1199): the original predicate here —
 * `role === "representante" && no membership` — also matched a REPRESENTED
 * student's own row: a child enrolled by a representative has no `Usuario`/
 * login of her own, so the roles-bulk lookup
 * (`members-adapter.ts#buildMemberAccounts`) never resolves her `ALUMNO`
 * role and she defaults to `role: "representante"`, same as her
 * representative. Every row is already one persona (issue #388 — no nesting
 * to unwrap), so `representadoPor` is what actually tells the payer's own
 * row apart from a represented student's row: it is set ONLY on the latter
 * (see `members-adapter.ts#buildMemberAccounts`). Checking it first — and
 * short-circuiting to "not the payer's row" whenever it is set — fixes that
 * misclassification without touching the backend role lookup, while the
 * membership check keeps covering the representative who also plays and
 * carries her own membership (`tests/e2e/members-pagos-page.spec.ts`).
 *
 * `role === "estudiante"` accounts are never hidden here even before their
 * first membership exists — that is exactly the account the "Pagos" entry
 * point's `CreateMembershipForm` fallback exists for.
 */
export function isRepresentativePersonaRow(account: MemberAccount): boolean {
  return (
    account.role === "representante" &&
    account.representadoPor === undefined &&
    !account.estudiantes.some((s) => s.membresia !== null)
  );
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

/**
 * «Socio antiguo» result line: the one-month period that starts at the last
 * payment ends at `fechaFin`; from that day on the member either is covered
 * (`fechaFin >= hoy`) or owes (`Debe desde`).
 */
export function describeEstadoMigracion(fechaFin: string, hoy: string): string {
  return fechaFin >= hoy ? `Al día hasta ${formatDate(fechaFin)}` : `Debe desde ${formatDate(fechaFin)}`;
}

/**
 * Whether a member still has no first coverage (no membership, or a never
 * covered INACTIVA one with no payment awaiting validation): the only moment
 * the admin is asked «¿Socio nuevo o socio antiguo?».
 */
export function isPrimerPagoPendiente(student: MemberStudentSummary): boolean {
  const membresia = student.membresia;
  if (!membresia) return true;
  return (
    membresia.estadoBackend === "INACTIVA"
    && !membresia.cubiertoHasta
    && student.ultimoPago?.estado !== "pendiente_validacion"
  );
}
