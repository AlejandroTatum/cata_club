/**
 * Unit tests for the Gestionar Miembros pure helpers.
 *
 * Pure functions — no React dependencies, easy to test.
 * Pattern follows attendance-utils.test.ts and proof-utils.test.ts.
 */

import { describe, it, expect } from "vitest";
import { MOCK_MEMBER_ACCOUNTS } from "@/mocks/members";
import {
  buildMemberStats,
  formatMembershipPeriod,
  getPayerTypeLabel,
  countActiveStudents,
  filterAccounts,
  getAccountStatusBadge,
  getAccountStateBadge,
  normalizeText,
  accountMatchesFlag,
  countAccountsMatchingFlag,
  paginateAccounts,
  getTotalPages,
  MEMBERS_AGGREGATE_LIMIT,
  MEMBERS_PAGE_SIZE,
  MEMBERSHIP_TYPE_LABELS,
  type AccountState,
  type MemberAccount,
} from "../members-utils";
import { formatCurrency, formatDate } from "../../../lib/format-utils";

// ---------------------------------------------------------------------------
// buildMemberStats
// ---------------------------------------------------------------------------

describe("buildMemberStats", () => {
  it("returns zero stats for an empty list", () => {
    const stats = buildMemberStats([]);
    expect(stats).toEqual({
      totalAccounts: 0,
      totalStudents: 0,
      activeMemberships: 0,
      pendingPayments: 0,
      sinDatosEmergencia: 0,
    });
  });

  it("computes correct stats from mock data", () => {
    const stats = buildMemberStats(MOCK_MEMBER_ACCOUNTS);
    // Issue #388: one row per persona now, not one row per paying root — the
    // mock carries 6 roots plus 8 people they represent.
    expect(stats.totalAccounts).toBe(14);
    expect(stats.totalStudents).toBeGreaterThan(0);
    // Validate counts are consistent: every student is counted once
    const expectedStudents = MOCK_MEMBER_ACCOUNTS.reduce(
      (acc, a) => acc + a.estudiantes.length,
      0,
    );
    expect(stats.totalStudents).toBe(expectedStudents);
    // Every row is exactly one person now, so the two totals coincide.
    expect(stats.totalStudents).toBe(stats.totalAccounts);
  });

  it("counts active memberships correctly", () => {
    // Memberships known to be active: Sofía (stu-001), Mateo (stu-002),
    // Valentina (stu-004), Nicolás (rp-004, self-managed).
    const stats = buildMemberStats(MOCK_MEMBER_ACCOUNTS);
    expect(stats.activeMemberships).toBe(4);
  });

  it("counts pending payments correctly", () => {
    // Pending payments: Mateo (stu-002), Emilia (stu-003), Santiago (stu-007).
    const stats = buildMemberStats(MOCK_MEMBER_ACCOUNTS);
    expect(stats.pendingPayments).toBe(3);
  });

  it("excludes archived and suspended students from operational metrics and chips", () => {
    const active = MOCK_MEMBER_ACCOUNTS[0];
    const archived = {
      ...active,
      id: "archived",
      estudiantes: [{ ...active.estudiantes[0], activo: false }],
    };
    const paused = {
      ...active,
      id: "paused",
      estudiantes: [{
        ...active.estudiantes[0],
        activo: true,
        membresia: { ...active.estudiantes[0].membresia!, estado: "suspendida" as const },
        ultimoPago: { ...active.estudiantes[0].ultimoPago!, estado: "pendiente_validacion" as const },
      }],
    };
    const stats = buildMemberStats([active, archived, paused]);
    expect(stats.totalStudents).toBe(2);
    expect(stats.pendingPayments).toBe(0);
    expect(accountMatchesFlag(archived, "vencida")).toBe(false);
    expect(accountMatchesFlag(paused, "pendiente")).toBe(false);
  });

  it("handles accounts with empty estudiantes arrays", () => {
    const accounts: MemberAccount[] = [
      {
        id: "rp-empty-students",
        role: "representante",
        nombres: "Test",
        apellidos: "User",
        email: "test@test.com",
        telefono: "+593 00 000 0000",
        estudiantes: [],
      },
      ...MOCK_MEMBER_ACCOUNTS,
    ];
    const stats = buildMemberStats(accounts);
    expect(stats.totalAccounts).toBe(15);
    expect(stats.totalStudents).toBe(14); // original 14 students
    expect(stats.activeMemberships).toBe(4);
  });

  // Issue #362: the "sin datos de emergencia" aggregate.
  it("counts accounts flagged sinDatosEmergencia and ignores the rest", () => {
    const flagged: MemberAccount = {
      id: "gap-001",
      role: "representante",
      nombres: "Gap",
      apellidos: "Case",
      telefono: "+593 00 000 0001",
      sinDatosEmergencia: true,
      estudiantes: [],
    };
    const notFlagged: MemberAccount = {
      id: "ok-001",
      role: "representante",
      nombres: "Ok",
      apellidos: "Case",
      telefono: "+593 00 000 0002",
      sinDatosEmergencia: false,
      estudiantes: [],
    };
    const unset: MemberAccount = {
      id: "unset-001",
      role: "representante",
      nombres: "Unset",
      apellidos: "Case",
      telefono: "+593 00 000 0003",
      estudiantes: [],
    };

    const stats = buildMemberStats([flagged, notFlagged, unset]);
    expect(stats.sinDatosEmergencia).toBe(1);
  });
});

describe("MEMBERS_AGGREGATE_LIMIT", () => {
  it("defines the shared upstream aggregate limit as 200", () => {
    expect(MEMBERS_AGGREGATE_LIMIT).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------

describe("formatCurrency", () => {
  it("formats whole dollars with two decimal places", () => {
    // es-EC locale formats with $ prefix and comma as decimal separator.
    // The helper normalizes ICU literal parts, so output is consistently $X,XX.
    expect(formatCurrency(85)).toMatch(/^\$\d+,\d{2}$/);
  });

  it("formats cents correctly", () => {
    expect(formatCurrency(240.5)).toMatch(/^\$\d+,\d{2}$/);
    expect(formatCurrency(720)).toMatch(/^\$\d+,\d{2}$/);
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0,00");
  });

  it("handles NaN gracefully", () => {
    expect(formatCurrency(NaN)).toBe("$0,00");
  });

  it("handles Infinity and -Infinity gracefully", () => {
    expect(formatCurrency(Infinity)).toBe("$0,00");
    expect(formatCurrency(-Infinity)).toBe("$0,00");
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  it("renders a date deterministically in Ecuador timezone", () => {
    // "2026-07-01T12:00:00Z" is 07:00 in Guayaquil — same calendar day.
    expect(formatDate("2026-07-01T12:00:00.000Z")).toBe("01/07/2026");
  });

  it("handles different months", () => {
    expect(formatDate("2026-01-15T12:00:00.000Z")).toBe("15/01/2026");
    expect(formatDate("2026-12-25T12:00:00.000Z")).toBe("25/12/2026");
  });

  it("renders a date-only string as the correct calendar day — no UTC offset shift", () => {
    // "2014-03-15" parsed as UTC midnight → 14 Mar in Guayaquil (UTC-5).
    // Our fix interprets it as local calendar date → 15 Mar.
    expect(formatDate("2014-03-15")).toBe("15/03/2014");
  });

  it("renders end-of-month date-only strings correctly", () => {
    expect(formatDate("2026-01-31")).toBe("31/01/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
    expect(formatDate("2026-02-28")).toBe("28/02/2026");
  });

  it("renders first-of-month date-only strings correctly", () => {
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
    expect(formatDate("2026-06-01")).toBe("01/06/2026");
  });

  it("accepts valid leap-day date-only strings", () => {
    expect(formatDate("2020-02-29")).toContain("29");
  });

  it("returns empty string for an empty date string", () => {
    expect(formatDate("")).toBe("");
  });

  it("returns empty string for an invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDate("2026-13-01")).toBe("");
    expect(formatDate("2021-02-29")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// formatMembershipPeriod
// ---------------------------------------------------------------------------

describe("formatMembershipPeriod", () => {
  it("formats a monthly period in the product's one date grammar", () => {
    expect(formatMembershipPeriod("2026-07-01", "2026-07-31")).toBe("01/07/2026 – 31/07/2026");
  });

  it("formats a cross-month period the same way", () => {
    expect(formatMembershipPeriod("2026-07-01", "2026-09-30")).toBe("01/07/2026 – 30/09/2026");
  });

  it("carries the year on both ends so a period across a year boundary is unambiguous", () => {
    expect(formatMembershipPeriod("2026-12-01", "2027-01-31")).toBe("01/12/2026 – 31/01/2027");
  });

  it("returns empty string for invalid dates", () => {
    expect(formatMembershipPeriod("", "2026-07-31")).toBe("");
    expect(formatMembershipPeriod("2026-07-01", "")).toBe("");
    expect(formatMembershipPeriod("bad-date", "also-bad")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getPayerTypeLabel
// ---------------------------------------------------------------------------

describe("getPayerTypeLabel", () => {
  it('returns "Representante" for representante', () => {
    expect(getPayerTypeLabel("representante")).toBe("Representante");
  });

  it('returns "Estudiante" for estudiante', () => {
    expect(getPayerTypeLabel("estudiante")).toBe("Estudiante");
  });
});

// ---------------------------------------------------------------------------
// MEMBERSHIP_TYPE_LABELS
// ---------------------------------------------------------------------------

describe("MEMBERSHIP_TYPE_LABELS", () => {
  it('returns "Mensual" for mensual', () => {
    expect(MEMBERSHIP_TYPE_LABELS["mensual"]).toBe("Mensual");
  });

  it('returns "Trimestral" for trimestral', () => {
    expect(MEMBERSHIP_TYPE_LABELS["trimestral"]).toBe("Trimestral");
  });

  it('returns "Semestral" for semestral', () => {
    expect(MEMBERSHIP_TYPE_LABELS["semestral"]).toBe("Semestral");
  });

  it('returns "Anual" for anual', () => {
    expect(MEMBERSHIP_TYPE_LABELS["anual"]).toBe("Anual");
  });
});

// ---------------------------------------------------------------------------
// countActiveStudents
// ---------------------------------------------------------------------------

describe("countActiveStudents", () => {
  it("counts an active membership on a member's own single-element row", () => {
    // Issue #388: each row is one person now, so this counts 0 or 1 — Sofía
    // (stu-001) has an activa membership on her own row.
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "stu-001")!;
    expect(countActiveStudents(account)).toBe(1);
  });

  it("returns 0 when the row's own membership is not active", () => {
    // Camila (stu-005) has a vencida membership on her own row.
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "stu-005")!;
    expect(countActiveStudents(account)).toBe(0);
  });

  it("returns 0 for an account with no students", () => {
    const emptyAccount: MemberAccount = {
      id: "rp-empty",
      role: "representante",
      nombres: "Empty",
      apellidos: "Account",
      email: "empty@test.com",
      telefono: "+593 00 000 0000",
      estudiantes: [],
    };
    expect(countActiveStudents(emptyAccount)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getAccountStatusBadge
// ---------------------------------------------------------------------------

describe("getAccountStatusBadge", () => {
  it('returns "Activo" + the ok tone for a member with their own active membership', () => {
    // Sofía (stu-001) — her own row, her own activa membership.
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "stu-001")!;
    expect(getAccountStatusBadge(account)).toEqual({
      label: "Activo",
      tone: "ok",
    });
  });

  it('returns "Pago pendiente de validación" + the warn tone when not active but a payment awaits validation', () => {
    // Santiago (stu-007): vencida membership, pendiente_validacion payment —
    // on his own row, not aggregated with anyone else's.
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "stu-007")!;
    expect(getAccountStatusBadge(account)).toEqual({
      label: "Pago pendiente de validación",
      tone: "warn",
    });
  });

  it('returns "Membresía vencida" + the bad tone when not active and no pending validation but expired', () => {
    // Camila (stu-005): vencida membership, no payments at all.
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "stu-005")!;
    expect(getAccountStatusBadge(account)).toEqual({
      label: "Membresía vencida",
      tone: "bad",
    });
  });

  it('returns "Sin membresía" in the NEUTRAL tone — never red', () => {
    // Design system rule, non-negotiable: red is reserved for the primary CTA
    // and for errors/destructive actions. "Sin membresía" is a state the club
    // is not alarmed by — a brand-new account has it by definition — so
    // painting it the same colour as a failure was miscolouring, not emphasis.
    const emptyAccount: MemberAccount = {
      id: "rp-empty",
      role: "representante",
      nombres: "Empty",
      apellidos: "Account",
      email: "empty@test.com",
      telefono: "+593 00 000 0000",
      estudiantes: [],
    };
    expect(getAccountStatusBadge(emptyAccount)).toEqual({
      label: "Sin membresía",
      tone: "neutral",
    });
  });
});

// ---------------------------------------------------------------------------
// getAccountStateBadge (issue #869)
// ---------------------------------------------------------------------------

describe("getAccountStateBadge", () => {
  const baseAccount: MemberAccount = {
    id: "acc-cuenta",
    role: "representante",
    nombres: "Cuenta",
    apellidos: "De Prueba",
    telefono: "+593 00 000 0000",
    estudiantes: [],
  };

  it.each<[AccountState, { label: string; tone: string }]>([
    ["active", { label: "Activa", tone: "ok" }],
    ["inactive", { label: "Inactiva", tone: "bad" }],
    ["none", { label: "Sin cuenta", tone: "neutral" }],
  ])("renders %s as %o", (accountState, expected) => {
    expect(getAccountStateBadge({ ...baseAccount, accountState })).toEqual(expected);
  });

  it('defaults to "Sin cuenta" / neutral when the field is omitted', () => {
    // Same omit-rather-than-invent convention as `sinDatosEmergencia`: a
    // fixture that predates this field must not silently read as "Activa".
    expect(getAccountStateBadge(baseAccount)).toEqual({
      label: "Sin cuenta",
      tone: "neutral",
    });
  });

  it("never derives from Membresía — a vencida membership with an active account still reads Activa", () => {
    const account: MemberAccount = {
      ...baseAccount,
      accountState: "active",
      estudiantes: [
        {
          id: "est-1",
          nombres: "Alumno",
          apellidos: "Uno",
          activo: true,
          membresia: {
            tipo: "Mensual",
            estado: "vencida",
            fechaInicio: "2026-06-01",
            fechaFin: "2026-06-30",
            monto: 85,
            id: 1,
          },
          ultimoPago: null,
        },
      ],
    };
    expect(getAccountStateBadge(account)).toEqual({ label: "Activa", tone: "ok" });
    expect(getAccountStatusBadge(account)).toEqual({ label: "Membresía vencida", tone: "bad" });
  });
});

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------

describe("normalizeText", () => {
  it("removes acute accents", () => {
    expect(normalizeText("Martínez")).toBe("martinez");
    expect(normalizeText("Álvarez")).toBe("alvarez");
    expect(normalizeText("Pérez")).toBe("perez");
  });

  it("lowercases all characters", () => {
    expect(normalizeText("CARLOS")).toBe("carlos");
    expect(normalizeText("López")).toBe("lopez");
  });

  it("handles mixed accents and casing", () => {
    expect(normalizeText("José María")).toBe("jose maria");
    expect(normalizeText("María José")).toBe("maria jose");
  });

  it("handles empty string", () => {
    expect(normalizeText("")).toBe("");
  });

  it("trims whitespace-only strings to empty", () => {
    expect(normalizeText("   ")).toBe("");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeText("  Pérez  ")).toBe("perez");
    expect(normalizeText("\tMartínez\n")).toBe("martinez");
  });

  it("ñ is preserved (not an accent)", () => {
    expect(normalizeText("Muñoz")).toBe("muñoz");
  });

  it("handles strings without accents", () => {
    expect(normalizeText("hello world")).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// filterAccounts
// ---------------------------------------------------------------------------

describe("filterAccounts", () => {
  it("returns all accounts when search term is empty", () => {
    expect(filterAccounts(MOCK_MEMBER_ACCOUNTS, "")).toHaveLength(14);
  });

  it("returns a new array reference on empty search (immutable)", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "");
    expect(result).not.toBe(MOCK_MEMBER_ACCOUNTS);
  });

  it("returns all accounts when search term is only whitespace", () => {
    expect(filterAccounts(MOCK_MEMBER_ACCOUNTS, "   ")).toHaveLength(14);
  });

  it("filters by account name (case-insensitive), and by representative name (issue #388)", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "Carlos");
    // Two rows named Carlos (Martínez, Ramírez) plus the five people they
    // represent — issue #388's `representadoPor` match means a search by a
    // representative's own name also surfaces every row they pay for.
    expect(result).toHaveLength(7);
    expect(result.map((a) => a.id).sort()).toEqual(
      ["rp-001", "rp-005", "stu-001", "stu-002", "stu-003", "stu-007", "stu-008"].sort(),
    );
  });

  it("filters by email", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "ana.lopez");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rp-002");
  });

  it("filters by a person's own name — Sofía is her own row now, not nested under Carlos'", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "Sofía");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("stu-001");
  });

  it("matches a represented person's row by their representative's name (issue #388)", () => {
    // Searching "Ana López" (Valentina's representative) has to surface
    // Valentina's row — she is no longer nested inside Ana's, she is her own
    // row with `representadoPor: "Ana López"`.
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "Ana López");
    expect(result.map((a) => a.id).sort()).toEqual(["rp-002", "stu-004"].sort());
  });

  it("returns empty array when no match is found", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "zzzzz_no_match");
    expect(result).toHaveLength(0);
  });

  it("handles empty accounts array", () => {
    const result = filterAccounts([], "Carlos");
    expect(result).toHaveLength(0);
  });

  it("matches accent-insensitively — typed 'Martinez' finds 'Martínez'", () => {
    // Mock data has "Carlos Martínez" (rp-001)
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "Martinez");
    expect(result.some((a) => a.id === "rp-001")).toBe(true);
  });

  it("matches accent-insensitively — typed 'Lopez' finds 'López'", () => {
    // Mock data has "Ana López" (rp-002)
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "Lopez");
    expect(result.some((a) => a.id === "rp-002")).toBe(true);
  });

  it("matches accent-insensitively — typed 'Flores' finds 'Flores' (no accent needed)", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "flores");
    expect(result.some((a) => a.id === "rp-003")).toBe(true);
  });

  it("matches accent-insensitively — typed 'RAMIREZ' finds 'Ramírez'", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "RAMIREZ");
    expect(result.some((a) => a.id === "rp-005")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mock data integrity
// ---------------------------------------------------------------------------

describe("MOCK_MEMBER_ACCOUNTS", () => {
  it("has at least one account", () => {
    expect(MOCK_MEMBER_ACCOUNTS.length).toBeGreaterThan(0);
  });

  it("every account has required fields", () => {
    for (const account of MOCK_MEMBER_ACCOUNTS) {
      expect(account.id).toBeTruthy();
      expect(account.nombres).toBeTruthy();
      expect(account.apellidos).toBeTruthy();
      expect(account.email).toBeTruthy();
      expect(account.telefono).toBeTruthy();
      expect(["representante", "estudiante"] as const).toContain(account.role);
    }
  });

  it("every student has required fields", () => {
    for (const account of MOCK_MEMBER_ACCOUNTS) {
      for (const estudiante of account.estudiantes) {
        expect(estudiante.id).toBeTruthy();
        expect(estudiante.nombres).toBeTruthy();
        expect(estudiante.apellidos).toBeTruthy();
      }
    }
  });

  it("every account has at least one student", () => {
    for (const account of MOCK_MEMBER_ACCOUNTS) {
      expect(account.estudiantes.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// accountMatchesFlag / countAccountsMatchingFlag
// ---------------------------------------------------------------------------

describe("accountMatchesFlag", () => {
  it('"all" matches every account', () => {
    for (const account of MOCK_MEMBER_ACCOUNTS) {
      expect(accountMatchesFlag(account, "all")).toBe(true);
    }
  });

  it('"vencida" only matches accounts with at least one vencida membership', () => {
    const account: MemberAccount = {
      ...MOCK_MEMBER_ACCOUNTS[0],
      estudiantes: [
        {
          ...MOCK_MEMBER_ACCOUNTS[0].estudiantes[0],
          membresia: {
            tipo: "mensual",
            estado: "vencida",
            fechaInicio: "2026-01-01",
            fechaFin: "2026-02-01",
            monto: 85,
            id: 42,
          },
        },
      ],
    };
    expect(accountMatchesFlag(account, "vencida")).toBe(true);

    const noVencida: MemberAccount = {
      ...account,
      estudiantes: [{ ...account.estudiantes[0], membresia: null }],
    };
    expect(accountMatchesFlag(noVencida, "vencida")).toBe(false);
  });

  it('"pendiente" only matches accounts with at least one pending payment', () => {
    const account: MemberAccount = {
      ...MOCK_MEMBER_ACCOUNTS[0],
      estudiantes: [
        {
          ...MOCK_MEMBER_ACCOUNTS[0].estudiantes[0],
          ultimoPago: {
            estado: "pendiente_validacion",
            fechaPago: "2026-07-01",
            monto: 85,
            periodo: "Julio 2026",
          },
        },
      ],
    };
    expect(accountMatchesFlag(account, "pendiente")).toBe(true);

    const noPending: MemberAccount = {
      ...account,
      estudiantes: [{ ...account.estudiantes[0], ultimoPago: null }],
    };
    expect(accountMatchesFlag(noPending, "pendiente")).toBe(false);
  });

  /*
   * Issue #730, mitad B. The "Sin datos de emergencia" stat tile has counted
   * this population since issue #362, but a number is not a worklist: an
   * admin could read "42" and had no way to reach the 42. The chip reuses the
   * flag the adapter already computes, so the tile and the filter can never
   * disagree about who is in the gap — which is exactly why this is a new
   * `MemberFilterFlag` case and not a second predicate written next to it.
   */
  it('"sin-emergencia" matches exactly the accounts the stat tile counts', () => {
    const enElHueco: MemberAccount = {
      ...MOCK_MEMBER_ACCOUNTS[0],
      sinDatosEmergencia: true,
    };
    expect(accountMatchesFlag(enElHueco, "sin-emergencia")).toBe(true);

    const conFicha: MemberAccount = { ...enElHueco, sinDatosEmergencia: false };
    expect(accountMatchesFlag(conFicha, "sin-emergencia")).toBe(false);
  });

  it('"sin-emergencia" treats an absent flag as not-in-the-gap', () => {
    /*
     * `sinDatosEmergencia` is optional: the adapter omits it (never
     * fabricates `true`) when the bulk ficha lookup didn't resolve — see its
     * doc comment in members-utils.ts. A filter that read `undefined` as "in
     * the gap" would put every row of a degraded fetch on the worklist and
     * send an admin chasing people who are fine.
     */
    const sinBandera: MemberAccount = { ...MOCK_MEMBER_ACCOUNTS[0] };
    delete sinBandera.sinDatosEmergencia;
    expect(accountMatchesFlag(sinBandera, "sin-emergencia")).toBe(false);
  });
});

describe("countAccountsMatchingFlag", () => {
  it('"all" count equals the full account list length', () => {
    expect(countAccountsMatchingFlag(MOCK_MEMBER_ACCOUNTS, "all")).toBe(
      MOCK_MEMBER_ACCOUNTS.length,
    );
  });

  it("returns 0 for an empty account list", () => {
    expect(countAccountsMatchingFlag([], "vencida")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// paginateAccounts / getTotalPages (client-side members pagination)
// ---------------------------------------------------------------------------

function buildAccounts(count: number): MemberAccount[] {
  return Array.from({ length: count }, (_, i) => ({
    ...MOCK_MEMBER_ACCOUNTS[0],
    id: `acc-${i}`,
  }));
}

describe("paginateAccounts", () => {
  it("slices accounts to MEMBERS_PAGE_SIZE for page 1, and the remainder for a later page", () => {
    expect(MEMBERS_PAGE_SIZE).toBe(10);
    const accounts = buildAccounts(25);
    const page1 = paginateAccounts(accounts, 1);
    expect(page1).toHaveLength(10);
    expect(page1[0].id).toBe("acc-0");
    expect(page1[9].id).toBe("acc-9");
    const page3 = paginateAccounts(accounts, 3);
    expect(page3).toHaveLength(5);
    expect(page3[0].id).toBe("acc-20");
  });

  it("returns an empty array for a page beyond the data", () => {
    expect(paginateAccounts(buildAccounts(4), 5)).toEqual([]);
  });

  it("reflects a filtered subset, not the unfiltered total", () => {
    const accounts = buildAccounts(115);
    const filtered = accounts.filter((a) => a.id === "acc-0" || a.id === "acc-1");
    expect(paginateAccounts(filtered, 1)).toEqual(filtered);
    expect(getTotalPages(filtered.length, MEMBERS_PAGE_SIZE)).toBe(1);
  });
});

describe("getTotalPages", () => {
  it("rounds up to a whole page count, floored at 1 (never 0 pages)", () => {
    expect(getTotalPages(115, MEMBERS_PAGE_SIZE)).toBe(12);
    expect(getTotalPages(11, MEMBERS_PAGE_SIZE)).toBe(2);
    expect(getTotalPages(10, MEMBERS_PAGE_SIZE)).toBe(1);
    expect(getTotalPages(0, MEMBERS_PAGE_SIZE)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// representadoPor (issue #388)
//
// `getAccountIdentity` used to live here — it derived a "Representante · N
// jugadores" role from `estudiantes`, the group's list of dependants. Once
// every row is exactly one person (`estudiantes` always length 1, holding
// only that person), there is no dependant list left for it to summarize: it
// would always return `{ roles: [], represents: [] }`. Removed together with
// the row-disclosure UI it fed in `page.tsx` rather than kept as dead code.
// `representadoPor` — a plain optional string set directly from
// `Persona.representanteId` in `members-adapter.ts` — replaces it as the way
// a row says who, if anyone, pays for this person.
// ---------------------------------------------------------------------------

describe("MemberAccount.representadoPor", () => {
  it("is present with the representative's full name for a represented person", () => {
    const sofia = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "stu-001")!;
    expect(sofia.representadoPor).toBe("Carlos Martínez");
  });

  it("is undefined for a self-managed root", () => {
    const carlos = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "rp-001")!;
    expect(carlos.representadoPor).toBeUndefined();
  });
});
