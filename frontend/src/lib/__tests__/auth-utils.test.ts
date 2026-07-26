/**
 * Unit tests for auth utility functions.
 *
 * All utilities are pure functions — no React, no browser APIs required.
 */

import { describe, it, expect } from "vitest";
import {
  canAccess,
  getDefaultRoute,
  getRoleLabel,
  getNavLinksForRole,
  getUserInitials,
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

  it('returns "Estudiante" for estudiante', () => {
    expect(getRoleLabel("estudiante")).toBe("Estudiante");
  });

  it('returns a distinct, non-empty label for unsupported (not miscategorized as a real role)', () => {
    const label = getRoleLabel("unsupported");
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toBe(getRoleLabel("representante"));
  });
});

// ---------------------------------------------------------------------------
// getNavLinksForRole (RBAC nav contract — pure function, no React)
// ---------------------------------------------------------------------------

describe("getNavLinksForRole", () => {
  it("returns unauthenticated links when role is null", () => {
    const links = getNavLinksForRole(null);
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ href: "/", label: "Inicio" });
    expect(links[1]).toEqual({ href: "/login", label: "Iniciar Sesión" });
  });

  it("returns admin links including /groups, /members and /attendance", () => {
    const links = getNavLinksForRole("admin");
    expect(links).toHaveLength(8);
    expect(links[0]).toEqual({ href: "/", label: "Inicio" });
    expect(links[1]).toEqual({ href: "/dashboard", label: "Panel de Control" });
    expect(links[2]).toEqual({ href: "/members", label: "Miembros" });
    expect(links[3]).toEqual({ href: "/ranking", label: "Niveles" });
    expect(links[4]).toEqual({ href: "/groups", label: "Horarios" });
    expect(links[5]).toEqual({ href: "/payments", label: "Membresías y Pagos" });
    expect(links[6]).toEqual({ href: "/attendance", label: "Asistencias" });
    expect(links[7]).toEqual({ href: "/reports", label: "Reportes" });
  });

  // Labels are Spanish and name the destination. The old set said
  // "Dashboard", "Asistencia" and "Nivel".
  it("returns trainer links named after their destinations, in Spanish", () => {
    const links = getNavLinksForRole("trainer");
    expect(links).toHaveLength(4);
    expect(links[0]).toEqual({ href: "/", label: "Inicio" });
    expect(links[1]).toEqual({ href: "/trainer", label: "Mi día" });
    expect(links[2]).toEqual({ href: "/trainer/attendance", label: "Pasar lista" });
    expect(links[3]).toEqual({ href: "/trainer/nivel", label: "Niveles" });
  });

  it("gives the trainer's ladder the same nav label the admin's has", () => {
    // `/trainer/nivel` and `/ranking` render the SAME screen under the SAME
    // title, so the sidebar must not call it two different things depending on
    // who is signed in.
    const adminLabel = getNavLinksForRole("admin").find((l) => l.href === "/ranking")?.label;
    const trainerLabel = getNavLinksForRole("trainer").find(
      (l) => l.href === "/trainer/nivel",
    )?.label;
    expect(trainerLabel).toBe(adminLabel);
    expect(trainerLabel).toBe("Niveles");
  });

  it("keeps the trainer's level-assignment section reachable", () => {
    // Trainers do assign levels: the backend grants ENTRENADOR both
    // `asignar-nivel-inicial` and `mover-de-nivel`, and `/trainer/nivel` is a
    // live screen. The 403 that once justified hiding it came from the roster
    // endpoint, which now has a trainer-readable replacement.
    const links = getNavLinksForRole("trainer");
    expect(links.some((l) => l.href === "/trainer/nivel")).toBe(true);
  });

  it("uses no English labels in any role's navigation", () => {
    for (const role of ["admin", "trainer", "representante", "estudiante"] as const) {
      for (const link of getNavLinksForRole(role)) {
        expect(link.label).not.toMatch(/dashboard/i);
      }
    }
  });

  it("returns only Inicio for unsupported (no role-specific nav)", () => {
    const links = getNavLinksForRole("unsupported");
    expect(links).toEqual([{ href: "/", label: "Inicio" }]);
  });

  it("returns representante links to Mi cuenta, Pagos and Asistencias", () => {
    const links = getNavLinksForRole("representante");
    expect(links).toHaveLength(4);
    expect(links[0]).toEqual({ href: "/", label: "Inicio" });
    expect(links[1]).toEqual({ href: "/student", label: "Mi cuenta" });
    expect(links[2]).toEqual({ href: "/student/payments", label: "Pagos" });
    expect(links[3]).toEqual({ href: "/student/attendance", label: "Asistencias" });
  });

  it("returns estudiante links to Mi cuenta, Pagos and Asistencias", () => {
    const links = getNavLinksForRole("estudiante");
    expect(links).toHaveLength(4);
    expect(links[0]).toEqual({ href: "/", label: "Inicio" });
    expect(links[1]).toEqual({ href: "/student", label: "Mi cuenta" });
    expect(links[2]).toEqual({ href: "/student/payments", label: "Pagos" });
    // Paying and checking attendance are the two things a student opens the
    // portal to do, so both are reachable from the nav, not only from a panel.
    expect(links[3]).toEqual({ href: "/student/attendance", label: "Asistencias" });
  });

  it("every recognized role gets Inicio as first link and at least one role-specific link", () => {
    const rolesWithNav = ALL_ROLES.filter((role) => role !== "unsupported");
    for (const role of rolesWithNav) {
      const links = getNavLinksForRole(role);
      expect(links.length).toBeGreaterThanOrEqual(2);
      expect(links[0].href).toBe("/");
      expect(links[0].label).toBe("Inicio");
    }
  });

  it("every role (including unsupported) at least gets Inicio as first link", () => {
    for (const role of ALL_ROLES) {
      const links = getNavLinksForRole(role);
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links[0].href).toBe("/");
      expect(links[0].label).toBe("Inicio");
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
