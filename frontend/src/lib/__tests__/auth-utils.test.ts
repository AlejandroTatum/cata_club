/**
 * Unit tests for auth utility functions.
 *
 * All utilities are pure functions — no React, no browser APIs required.
 */

import { describe, it, expect } from "vitest";
import {
  backendRoleForUserRole,
  canAccess,
  getBackendRoleLabel,
  getDefaultRoute,
  getRoleLabel,
  getNavGroupsForRoles,
  getUserInitials,
  userRolesFromBackendRoles,
  type NavGroup,
} from "../auth-utils";
import type { UserRole } from "@/types/domain";

const ALL_ROLES: UserRole[] = [
  "admin",
  "trainer",
  "representante",
  "estudiante",
  "unsupported",
];

// ---------------------------------------------------------------------------
// canAccess
// ---------------------------------------------------------------------------

describe("canAccess", () => {
  it("allows access when role is in allowedRoles", () => {
    expect(canAccess("admin", ["admin"])).toBe(true);
    expect(canAccess("admin", ["admin", "trainer"])).toBe(true);
    expect(canAccess("trainer", ["admin", "trainer", "estudiante"])).toBe(true);
  });

  it("denies access when role is not in allowedRoles", () => {
    expect(canAccess("estudiante", ["admin"])).toBe(false);
    expect(canAccess("trainer", ["estudiante"])).toBe(false);
  });

  it("denies access when role is null (unauthenticated)", () => {
    expect(canAccess(null, ["admin"])).toBe(false);
    expect(canAccess(null, ["admin", "trainer", "estudiante"])).toBe(false);
    expect(canAccess(null, [])).toBe(false);
  });

  it("denies access when allowedRoles is empty", () => {
    expect(canAccess("admin", [])).toBe(false);
    expect(canAccess("estudiante", [])).toBe(false);
  });

  it("covers every role", () => {
    for (const role of ALL_ROLES) {
      expect(canAccess(role, ALL_ROLES)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// getDefaultRoute
// ---------------------------------------------------------------------------

describe("getDefaultRoute", () => {
  it('returns "/dashboard" for admin', () => {
    expect(getDefaultRoute("admin")).toBe("/dashboard");
  });

  it('returns "/trainer" for trainer', () => {
    expect(getDefaultRoute("trainer")).toBe("/trainer");
  });

  it('returns "/student" for representante', () => {
    expect(getDefaultRoute("representante")).toBe("/student");
  });

  it('returns "/student" for estudiante', () => {
    expect(getDefaultRoute("estudiante")).toBe("/student");
  });

  it('returns "/unauthorized" for unsupported (never a real role\'s page, never a crash)', () => {
    expect(getDefaultRoute("unsupported")).toBe("/unauthorized");
  });

  it("returns a valid path for every role", () => {
    for (const role of ALL_ROLES) {
      const route = getDefaultRoute(role);
      expect(route).toMatch(/^\//);
      expect(route.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getRoleLabel
// ---------------------------------------------------------------------------

describe("getRoleLabel", () => {
  it('returns "Administrador" for admin', () => {
    expect(getRoleLabel("admin")).toBe("Administrador");
  });

  it('returns "Entrenador" for trainer', () => {
    expect(getRoleLabel("trainer")).toBe("Entrenador");
  });

  it('returns "Representante" for representante', () => {
    expect(getRoleLabel("representante")).toBe("Representante");
  });

  /**
   * D9's vocabulary ruling, applied to the label the SESSION resolves to.
   *
   * The product had three words for one person — *Jugador* when enrolling,
   * *alumno* in the role table, *estudiante* here — and `/profile` showed two
   * of them at once: this label on the identity panel and `getBackendRoleLabel`
   * a few rows below it. `IdentityCell`'s `MEMBER_ROLE_LABELS` already settled
   * which word wins ("Jugador", the word the person read the day they walked
   * into the club); these two functions are the last visible holdouts.
   *
   * Only the WORD moves. `UserRole` stays `"estudiante"`, `/student` stays
   * `/student`, and `BackendTipoRol` stays `"ALUMNO"` — the route table and the
   * backend enum are not vocabulary.
   */
  it('returns "Jugador" for estudiante — the one word D9 settled on', () => {
    expect(getRoleLabel("estudiante")).toBe("Jugador");
  });

  it('returns a distinct, non-empty label for unsupported (not miscategorized as a real role)', () => {
    const label = getRoleLabel("unsupported");
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe(getRoleLabel("representante"));
  });
});

describe("getBackendRoleLabel", () => {
  it('names ALUMNO "Jugador", the same word getRoleLabel uses', () => {
    // These two run side by side on `/profile`: the session's role heads the
    // identity panel, and every assigned backend role is listed in "Información
    // de tu rol". Two spellings of one role there is the defect D9 names.
    expect(getBackendRoleLabel("ALUMNO")).toBe("Jugador");
    expect(getBackendRoleLabel("ALUMNO")).toBe(getRoleLabel("estudiante"));
  });

  it("keeps the other three role words unabbreviated", () => {
    // The rule of words: no "Rep.", no "Admin".
    expect(getBackendRoleLabel("ADMINISTRADOR")).toBe("Administrador");
    expect(getBackendRoleLabel("ENTRENADOR")).toBe("Entrenador");
    expect(getBackendRoleLabel("REPRESENTANTE")).toBe("Representante");
  });
});

// ---------------------------------------------------------------------------
// getNavGroupsForRoles (the rail's contract — pure function, no React)
//
// The rail is the UNION of the sections a person holds, drawn as one group per
// role with a heading of its own — D12d of `docs/ux/rediseno-visual-2026-08.md`.
//
// Since issue #762 no session reaches this function with more than one role:
// exactly one active role per account is a database invariant (#785) and the
// BFF refuses to build a session out of anything else. So the multi-role cases
// below test the function's contract, not the product's behaviour — a caller
// can still pass two roles, and what it does with them should stay defined and
// deduplicated rather than becoming whatever falls out. What the PRODUCT
// offers, per role, is checked against each route's own guard in
// src/components/shell/__tests__/nav-guard-parity.test.tsx.
// ---------------------------------------------------------------------------

/** Every href the ROLE groups offer, in render order. The public rows are excluded. */
function sectionHrefs(groups: NavGroup[]): string[] {
  return groups
    .filter((group) => group.heading !== null)
    .flatMap((group) => group.links.map((link) => link.href));
}

/** The headings actually drawn, in order — the shape of the rail in one line. */
function headings(groups: NavGroup[]): (string | null)[] {
  return groups.filter((group) => group.heading !== null).map((group) => group.heading);
}

/** The four roles that grant sections. `"unsupported"` grants none, by definition. */
const ROLES_WITH_SECTIONS = ["admin", "trainer", "representante", "estudiante"] as const;

/**
 * Every non-empty combination of `ROLES_WITH_SECTIONS`, as bit patterns — the
 * fifteen role sets an account can actually hold. Enumerated rather than
 * hand-listed so a fifth role cannot be added to the product with its
 * combinations silently untested.
 */
function everyRoleCombination(): UserRole[][] {
  const combinations: UserRole[][] = [];
  for (let mask = 1; mask < 1 << ROLES_WITH_SECTIONS.length; mask += 1) {
    combinations.push(ROLES_WITH_SECTIONS.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return combinations;
}

describe("getNavGroupsForRoles", () => {
  it("returns the unauthenticated rows, under no heading, when roles is null", () => {
    const groups = getNavGroupsForRoles(null);
    expect(groups).toHaveLength(1);
    // `null`, not "Inicio": these two rows name no section of the product, and
    // a heading invented for them would be drawn the moment a second group
    // appeared beside it.
    expect(groups[0].heading).toBeNull();
    expect(groups[0].links).toEqual([
      { href: "/", label: "Inicio" },
      // Sentence case since D12b: `lib/destinations.ts` owns the name now, and
      // every other multi-word row in the product capitalises only the first word.
      { href: "/login", label: "Iniciar sesión" },
    ]);
  });

  it("puts every admin destination under Administrar", () => {
    const groups = getNavGroupsForRoles(["admin"]);
    expect(groups[0].links).toEqual([{ href: "/", label: "Inicio" }]);
    expect(groups[1]).toEqual({
      heading: "Administrar",
      links: [
        { href: "/dashboard", label: "Panel de Control" },
        { href: "/members", label: "Miembros" },
        { href: "/groups", label: "Horarios" },
        { href: "/payments", label: "Membresías y Pagos" },
        { href: "/discounts", label: "Descuentos" },
        { href: "/sponsors", label: "Patrocinadores" },
        { href: "/tarifas", label: "Tarifas" },
        { href: "/attendance", label: "Asistencias" },
        { href: "/reports", label: "Reportes" },
      ],
    });
    expect(groups).toHaveLength(2);
  });

  // The four trainer destinations, in the exact order the sidebar shows them.
  // Asserted as the whole group (not `.some(...)`) so dropping one, renaming
  // it, or reordering "Historial" against "Pasar lista" all fail here — the
  // order is what `resolveActiveHref` and the sidebar render.
  //
  // "Alumnos del club" va última: es consulta, no trabajo del día. Las tres
  // primeras son la secuencia de una sesión (mirar el día, pasar lista, revisar
  // lo pasado) y meter el padrón en medio partiría esa secuencia.
  it("gives trainer exactly Mi día, Pasar lista, Historial and Alumnos del club under Entrenar", () => {
    const groups = getNavGroupsForRoles(["trainer"]);
    expect(groups[1]).toEqual({
      heading: "Entrenar",
      links: [
        { href: "/trainer", label: "Mi día" },
        { href: "/trainer/attendance", label: "Pasar lista" },
        { href: "/trainer/attendance/history", label: "Historial" },
        { href: "/trainer/students", label: "Alumnos del club" },
      ],
    });
    expect(groups).toHaveLength(2);
  });

  it("gives representante Mi cuenta, Pagos, Asistencias and Ficha médica", () => {
    const groups = getNavGroupsForRoles(["representante"]);
    expect(groups[1]).toEqual({
      heading: "Mi cuenta",
      links: [
        { href: "/student", label: "Mi cuenta" },
        { href: "/student/payments", label: "Pagos" },
        { href: "/student/attendance", label: "Asistencias" },
        // Only a representante has a representado whose medical record they can
        // manage — see `PoliticaAccesoPersona`'s `incluir_titular=False` on
        // `/fichas-medicas/*`, which still excludes a self-managed titular. An
        // "estudiante" nav (below) never gets this entry, so it never points a
        // self-managed student at a screen the backend will 403 them out of.
        { href: "/student/medical-record", label: "Ficha médica" },
      ],
    });
  });

  it("gives estudiante Mi cuenta, Pagos and Asistencias — no Ficha médica", () => {
    const groups = getNavGroupsForRoles(["estudiante"]);
    expect(groups[1]).toEqual({
      heading: "Mi cuenta",
      links: [
        { href: "/student", label: "Mi cuenta" },
        { href: "/student/payments", label: "Pagos" },
        // Paying and checking attendance are the two things a student opens the
        // portal to do, so both are reachable from the nav, not only from a panel.
        { href: "/student/attendance", label: "Asistencias" },
      ],
    });
    // A self-managed alumno has no representado and the backend still excludes
    // the titular from their own medical record (out of scope of this change)
    // — the nav must not offer a destination that 403s.
    expect(sectionHrefs(groups)).not.toContain("/student/medical-record");
  });

  // A minor with their own "estudiante" account still gets no Ficha médica
  // entry: incluir_titular on GET/PATCH /fichas-medicas/persona/{id} is
  // age-gated backend-side (ficha_medica_router.py::_es_titular_mayor_de_edad).
  // Offering the destination anyway would only hand a minor a 403.
  it("does not add a Ficha médica row for a minor estudiante", () => {
    expect(sectionHrefs(getNavGroupsForRoles(["estudiante"], false))).not.toContain(
      "/student/medical-record",
    );
  });

  it("adds a Ficha médica row for an adult estudiante", () => {
    const groups = getNavGroupsForRoles(["estudiante"], true);
    expect(groups[1].links.at(-1)).toEqual({
      href: "/student/medical-record",
      label: "Ficha médica",
    });
  });

  // The age flag is scoped to "estudiante" only. "representante" already gets
  // the Ficha médica row unconditionally (that access — a guardian managing a
  // DEPENDENT's record — is a separate, unrelated grant), so toggling
  // `studentIsAdult` must not change its result either way.
  it("ignores the adult flag for representante", () => {
    expect(getNavGroupsForRoles(["representante"], true)).toEqual(
      getNavGroupsForRoles(["representante"], false),
    );
  });

  it("returns only the public row for unsupported, and for no recognised role at all", () => {
    const publicOnly = [{ heading: null, links: [{ href: "/", label: "Inicio" }] }];
    expect(getNavGroupsForRoles(["unsupported"])).toEqual(publicOnly);
    expect(getNavGroupsForRoles([])).toEqual(publicOnly);
  });

  it("uses no English labels in any role's navigation", () => {
    for (const role of ROLES_WITH_SECTIONS) {
      for (const group of getNavGroupsForRoles([role])) {
        for (const link of group.links) {
          expect(link.label).not.toMatch(/dashboard/i);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // The four cases D12d decides. Read together they are the decision itself:
  // the rail is the union of the person's sections, and no selector switches
  // between them.
  // -------------------------------------------------------------------------

  it("draws one group for someone who only plays", () => {
    expect(headings(getNavGroupsForRoles(["estudiante"]))).toEqual(["Mi cuenta"]);
  });

  it("draws one group for someone who administers", () => {
    expect(headings(getNavGroupsForRoles(["admin"]))).toEqual(["Administrar"]);
  });

  // The 18 accounts that already exist. Both roles name the same section of the
  // product, so the answer is ONE group holding the union of their rows — not
  // two groups called "Mi cuenta" side by side.
  it("draws a single Mi cuenta for someone who plays and represents", () => {
    const groups = getNavGroupsForRoles(["representante", "estudiante"]);
    expect(headings(groups)).toEqual(["Mi cuenta"]);
    expect(sectionHrefs(groups)).toEqual([
      "/student",
      "/student/payments",
      "/student/attendance",
      "/student/medical-record",
    ]);
  });

  // The case the product cannot express today: a trainer who also plays saw
  // only the trainer's panel, so his own fees and his own attendance did not
  // exist for him.
  it("draws Entrenar and Mi cuenta for someone who trains and plays", () => {
    const groups = getNavGroupsForRoles(["trainer", "estudiante"]);
    expect(headings(groups)).toEqual(["Entrenar", "Mi cuenta"]);
    expect(sectionHrefs(groups)).toEqual([
      "/trainer",
      "/trainer/attendance",
      "/trainer/attendance/history",
      "/trainer/students",
      "/student",
      "/student/payments",
      "/student/attendance",
    ]);
  });

  // -------------------------------------------------------------------------
  // The locks. These are the two properties a future "simplification" would
  // have to break in order to collapse the rail back to one role.
  // -------------------------------------------------------------------------

  it("never offers the same destination twice, for any combination of roles", () => {
    for (const roles of everyRoleCombination()) {
      for (const studentIsAdult of [false, true]) {
        const hrefs = sectionHrefs(getNavGroupsForRoles(roles, studentIsAdult));
        expect(new Set(hrefs).size).toBe(hrefs.length);
      }
    }
  });

  it("offers exactly the union of what each role offers on its own", () => {
    for (const roles of everyRoleCombination()) {
      for (const studentIsAdult of [false, true]) {
        const combined = new Set(sectionHrefs(getNavGroupsForRoles(roles, studentIsAdult)));
        const union = new Set(
          roles.flatMap((role) => sectionHrefs(getNavGroupsForRoles([role], studentIsAdult))),
        );
        expect([...combined].sort()).toEqual([...union].sort());
      }
    }
  });

  it("orders the groups the same way whatever order the roles arrive in", () => {
    const expected = ["Administrar", "Entrenar", "Mi cuenta"];
    expect(headings(getNavGroupsForRoles(["admin", "trainer", "estudiante"]))).toEqual(expected);
    expect(headings(getNavGroupsForRoles(["estudiante", "trainer", "admin"]))).toEqual(expected);
    expect(headings(getNavGroupsForRoles(["trainer", "admin", "representante"]))).toEqual(expected);
  });

  it("collapses a role listed twice into one group", () => {
    expect(getNavGroupsForRoles(["admin", "admin"])).toEqual(getNavGroupsForRoles(["admin"]));
  });

  it("keeps Inicio first, under no heading, for every combination of roles", () => {
    for (const roles of [null, [], ...everyRoleCombination()]) {
      const groups = getNavGroupsForRoles(roles);
      expect(groups[0].heading).toBeNull();
      expect(groups[0].links[0]).toEqual({ href: "/", label: "Inicio" });
    }
  });
});

// ---------------------------------------------------------------------------
// userRolesFromBackendRoles
// ---------------------------------------------------------------------------

describe("userRolesFromBackendRoles", () => {
  it("maps every backend role the session can carry", () => {
    expect(userRolesFromBackendRoles(["ADMINISTRADOR", "ENTRENADOR", "REPRESENTANTE", "ALUMNO"]))
      .toEqual(["admin", "trainer", "representante", "estudiante"]);
  });

  // `AuthSession.roles` is typed `string[]`, not `BackendTipoRol[]` — a role
  // the backend adds tomorrow arrives here as an unknown string, and an
  // unknown role grants no section rather than crashing the rail.
  it("drops a role the frontend does not recognise", () => {
    expect(userRolesFromBackendRoles(["ALUMNO", "TESORERO"])).toEqual(["estudiante"]);
    expect(userRolesFromBackendRoles([])).toEqual([]);
  });

  // The inverse of `backendRoleForUserRole`, and the two must stay inverses:
  // one names the backend role behind a UserRole, the other reads the session's
  // role array back into UserRoles.
  it("round-trips with backendRoleForUserRole for every real role", () => {
    for (const role of ROLES_WITH_SECTIONS) {
      const backendRole = backendRoleForUserRole(role);
      expect(backendRole).not.toBeNull();
      expect(userRolesFromBackendRoles([backendRole as string])).toEqual([role]);
    }
  });
});

// ---------------------------------------------------------------------------
// getUserInitials
// ---------------------------------------------------------------------------

describe("getUserInitials", (): void => {
  it("takes the first letter of the first two words", (): void => {
    expect(getUserInitials("Alejandro Padilla")).toBe("AP");
  });

  it("uppercases lowercase input", (): void => {
    expect(getUserInitials("maría gómez")).toBe("MG");
  });

  it("returns a single letter for a one-word name", (): void => {
    expect(getUserInitials("Admin")).toBe("A");
  });

  it("ignores a third+ word", (): void => {
    expect(getUserInitials("Juan Carlos Pérez")).toBe("JC");
  });

  it("collapses repeated whitespace", (): void => {
    expect(getUserInitials("  Ana   López  ")).toBe("AL");
  });

  it("returns \"?\" for an empty or blank name", (): void => {
    expect(getUserInitials("")).toBe("?");
    expect(getUserInitials("   ")).toBe("?");
  });
});
