/**
 * Pure utility functions and mock data for the Gestionar Miembros admin page.
 *
 * Extracted from page.tsx for testability — no React dependencies.
 * Follows the same pattern as attendance-utils.ts and proof-utils.ts.
 */

import type {
  TipoMembresia,
  EstadoMembresia,
} from "@/types/domain";

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
   * Issue #362: this person has no legal representative at all
   * (`representanteId === null`) AND no ficha médica on file. Optional (not
   * required) for the same reason `representadoPor` is — fixtures and tests
   * that don't exercise the emergency-data gap can omit it and it reads as
   * falsy, same as a persona the adapter never flagged.
   */
  sinDatosEmergencia?: boolean;
}

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
 * Build aggregate statistics from the member accounts list.
 */
export function buildMemberStats(accounts: MemberAccount[]): MemberStats {
  let totalStudents = 0;
  let activeMemberships = 0;
  let pendingPayments = 0;
  let sinDatosEmergencia = 0;

  for (const account of accounts) {
    if (account.sinDatosEmergencia) {
      sinDatosEmergencia++;
    }
    for (const estudiante of account.estudiantes) {
      totalStudents++;
      if (estudiante.membresia?.estado === "activa") {
        activeMemberships++;
      }
      if (estudiante.ultimoPago?.estado === "pendiente_validacion") {
        pendingPayments++;
      }
    }
  }

  return {
    totalAccounts: accounts.length,
    totalStudents,
    activeMemberships,
    pendingPayments,
    sinDatosEmergencia,
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
export type MemberFilterFlag = "all" | "vencida" | "pendiente";

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
      return account.estudiantes.some((s) => s.membresia?.estado === "vencida");
    case "pendiente":
      return account.estudiantes.some((s) => s.ultimoPago?.estado === "pendiente_validacion");
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
