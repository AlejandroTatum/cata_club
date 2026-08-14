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
  getAccountIdentity,
  getPayerTypeLabel,
  countActiveStudents,
  filterAccounts,
  getAccountStatusBadge,
  normalizeText,
  accountMatchesFlag,
  countAccountsMatchingFlag,
  paginateAccounts,
  getTotalPages,
  MEMBERS_AGGREGATE_LIMIT,
  MEMBERS_PAGE_SIZE,
  MEMBERSHIP_TYPE_LABELS,
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
    });
  });

  it("computes correct stats from mock data", () => {
    const stats = buildMemberStats(MOCK_MEMBER_ACCOUNTS);
    expect(stats.totalAccounts).toBe(6);
    expect(stats.totalStudents).toBeGreaterThan(0);
    // Validate counts are consistent: every student is counted once
    const expectedStudents = MOCK_MEMBER_ACCOUNTS.reduce(
      (acc, a) => acc + a.estudiantes.length,
      0,
    );
    expect(stats.totalStudents).toBe(expectedStudents);
  });

  it("counts active memberships correctly", () => {
    // Memberships known to be active: Sofia (rp-001 stu-001),
    // Mateo (rp-001 stu-002), Valentina (rp-002 stu-004),
    // Nicolas (rp-004 stu-006)
    const stats = buildMemberStats(MOCK_MEMBER_ACCOUNTS);
    expect(stats.activeMemberships).toBe(4);
  });

  it("counts pending payments correctly", () => {
    // Pending payments: Mateo (rp-001 stu-002), Emilia (rp-001 stu-003),
    // Santiago (rp-005 stu-007)
    const stats = buildMemberStats(MOCK_MEMBER_ACCOUNTS);
    expect(stats.pendingPayments).toBe(3);
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
    expect(stats.totalAccounts).toBe(7);
    expect(stats.totalStudents).toBe(9); // original 9 students
    expect(stats.activeMemberships).toBe(4);
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
  it("counts active memberships for an account", () => {
    // rp-001 (Carlos Martinez): Sofia (activa), Mateo (activa), Emilia (vencida)
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "rp-001")!;
    expect(countActiveStudents(account)).toBe(2);
  });

  it("returns 0 when no students have active membership", () => {
    // rp-005 (Carlos Ramirez): both students have vencida
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "rp-005")!;
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
  it('returns "Activo" + the ok tone when account has active students', () => {
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "rp-001")!;
    expect(getAccountStatusBadge(account)).toEqual({
      label: "Activo",
      tone: "ok",
    });
  });

  it('returns "Pago pendiente de validación" + the warn tone when no active memberships but pending validation', () => {
    // rp-005 (Carlos Ramirez): both students have vencida memberships,
    // but Santiago (stu-007) has pendiente_validacion payment
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "rp-005")!;
    expect(getAccountStatusBadge(account)).toEqual({
      label: "Pago pendiente de validación",
      tone: "warn",
    });
  });

  it('returns "Membresía vencida" + the bad tone when no active and no pending validation but expired', () => {
    // rp-003 (Diego Flores): Camila has vencida membership, no payments at all
    const account = MOCK_MEMBER_ACCOUNTS.find((a) => a.id === "rp-003")!;
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
    expect(filterAccounts(MOCK_MEMBER_ACCOUNTS, "")).toHaveLength(6);
  });

  it("returns a new array reference on empty search (immutable)", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "");
    expect(result).not.toBe(MOCK_MEMBER_ACCOUNTS);
  });

  it("returns all accounts when search term is only whitespace", () => {
    expect(filterAccounts(MOCK_MEMBER_ACCOUNTS, "   ")).toHaveLength(6);
  });

  it("filters by account name (case-insensitive)", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "Carlos");
    expect(result).toHaveLength(2); // Carlos Martínez (rp-001), Carlos Ramírez (rp-005)
  });

  it("filters by email", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "ana.lopez");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rp-002");
  });

  it("filters by student name", () => {
    const result = filterAccounts(MOCK_MEMBER_ACCOUNTS, "Sofía");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rp-001");
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
// getAccountIdentity
//
// D9 makes the identity cell a shared piece, and `IdentityCell` takes the roles
// a person holds plus the players they represent. This row does not carry the
// roles array: `PersonaResponseDTO` has no `roles` field and no bulk "roles by
// persona" endpoint exists (gap #1 in `lib/server/members-adapter.ts`), so the
// adapter labels every root `role: "representante"` as a hardcoded literal and
// the real roles are only read one account at a time, inside the edit dialog.
//
// So this function draws what the row HAS and nothing more: the payer type it
// declares, and the names of the dependants it actually holds. It never
// promotes a hunch to a role, and it never lets an account represent itself.
// ---------------------------------------------------------------------------

describe("getAccountIdentity", () => {
  function account(overrides: Partial<MemberAccount> = {}): MemberAccount {
    return {
      id: "rp-1",
      role: "representante",
      nombres: "Marta",
      apellidos: "Salas",
      telefono: "0999999999",
      estudiantes: [],
      ...overrides,
    };
  }

  function student(id: string, nombres: string, apellidos: string) {
    return {
      id,
      nombres,
      apellidos,
      activo: true,
      membresia: null,
      ultimoPago: null,
    };
  }

  it("reads the payer type the row declares, in the club's own role vocabulary", () => {
    expect(getAccountIdentity(account({ role: "representante" })).roles).toEqual([
      "REPRESENTANTE",
    ]);
    expect(getAccountIdentity(account({ role: "estudiante" })).roles).toEqual(["ALUMNO"]);
  });

  it("names every player the account holds, because a representative holds several", () => {
    const identity = getAccountIdentity(
      account({
        estudiantes: [
          student("stu-1", "Ana", "Pérez"),
          student("stu-2", "Luis", "Pérez"),
          student("stu-3", "Sofía", "Pérez"),
        ],
      }),
    );
    expect(identity.represents).toEqual(["Ana Pérez", "Luis Pérez", "Sofía Pérez"]);
  });

  it("never lets an account represent itself", () => {
    // A root persona with no dependants comes back from the adapter holding
    // ITSELF as its only "estudiante" (`estudiantesSource = children.length > 0
    // ? children : [root]`). Passing that straight through would print
    // "Representante de Marta Salas" on Marta Salas' own row.
    const identity = getAccountIdentity(
      account({ id: "42", estudiantes: [student("42", "Marta", "Salas")] }),
    );
    expect(identity.represents).toEqual([]);
  });

  it("degrades to the role alone rather than inventing a name for it", () => {
    const identity = getAccountIdentity(account({ estudiantes: [] }));
    expect(identity.roles).toEqual(["REPRESENTANTE"]);
    expect(identity.represents).toEqual([]);
  });

  it("keeps the other dependants when one of them is the account itself", () => {
    const identity = getAccountIdentity(
      account({
        id: "42",
        estudiantes: [student("42", "Marta", "Salas"), student("7", "Ana", "Pérez")],
      }),
    );
    expect(identity.represents).toEqual(["Ana Pérez"]);
  });
});
