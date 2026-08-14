/**
 * Unit tests for the route → chrome contract.
 *
 * The regression these lock down: matching used to be an exact-match `Set`,
 * so a flow changed chrome halfway through (`/student` sidebar →
 * `/student/add-dependent` dark top nav), while `/student/enroll` — the
 * PUBLIC enrollment funnel — must keep public chrome even though it sits
 * under an app-shell prefix.
 */

import { describe, it, expect } from "vitest";
import { resolveShellKind, hidesTopHeader } from "@/lib/shell-routes";
import { getNavGroupsForRoles } from "@/lib/auth-utils";
import type { UserRole } from "@/types/domain";

/**
 * DERIVED from the nav, not copied from it.
 *
 * The list below used to be typed out by hand, and that is how PR #26's bug got
 * in: a route was missing from `APP_SHELL_PREFIXES`, so it drew the public
 * header ON TOP of its own shell and navigating it flashed twice — and this
 * test mirrored the same omission in its own list, so it passed. A test that
 * copies the thing it checks cannot catch a gap in it; it can only agree.
 *
 * Reading the nav instead makes the assertion "every destination the sidebar
 * offers gets shell chrome", which is the actual contract. Add a nav entry and
 * forget its prefix, and this fails without anyone remembering to come here.
 */
/**
 * A `Record` and not an array, so the type system enforces the coverage: add a
 * role to `UserRole` and this stops compiling until it is listed here. An array
 * would have silently walked one role short — which is the same "the list drifts
 * from the thing it describes" failure this whole file exists to close.
 */
const ROLE_COVERAGE: Record<UserRole, true> = {
  admin: true,
  trainer: true,
  representante: true,
  estudiante: true,
  // Signed in, no usable role: it gets `/unauthorized` and no nav of its own.
  unsupported: true,
};
const ROLES = Object.keys(ROLE_COVERAGE) as UserRole[];

/**
 * The landing. It opens the one group that carries no heading — the rows that
 * name no section of the product — for every role, and it is
 * genuinely public chrome — `AppShell` drops it from the sidebar and spends it
 * on the brand link instead. The one destination that is a nav entry and not a
 * shell route, named here so the rule below stays "all of them".
 */
const PUBLIC_NAV_DESTINATIONS = new Set(["/"]);

const NAV_DESTINATIONS = [
  ...new Set(
    ROLES.flatMap((role) =>
      getNavGroupsForRoles([role]).flatMap((group) => group.links.map((link) => link.href)),
    ),
  ),
].filter((href) => !PUBLIC_NAV_DESTINATIONS.has(href));

describe("resolveShellKind", () => {
  it("gives the app shell to every destination the nav offers", () => {
    // A guard is worth nothing if the set it walks could be empty.
    expect(NAV_DESTINATIONS.length).toBeGreaterThan(5);

    for (const route of NAV_DESTINATIONS) {
      expect(resolveShellKind(route), `${route} draws the wrong chrome`).toBe("app");
    }
  });

  it("gives the app shell to the section roots the nav does not link", () => {
    // Reachable, shell-drawing, and deliberately absent from the sidebar.
    for (const route of ["/profile", "/admin/crear-cuenta", "/ayuda"]) {
      expect(resolveShellKind(route)).toBe("app");
    }
  });

  it("keeps the app shell for descendants of an app section", () => {
    expect(resolveShellKind("/trainer/attendance")).toBe("app");
    expect(resolveShellKind("/trainer/attendance/history")).toBe("app");
    expect(resolveShellKind("/student/add-dependent")).toBe("app");
  });

  it("gives /student/enroll its own chrome instead of the app shell above it", () => {
    /*
     * Session-free, so it must not inherit `/student`'s AppShell — but it is
     * not a top-nav page either. The wizard draws its own stepper and progress
     * header, and the public `Header` stacked a second horizontal bar over it.
     */
    expect(resolveShellKind("/student/enroll")).toBe("standalone");
    expect(resolveShellKind("/student/enroll/step")).toBe("standalone");
  });

  it("does not treat a longer sibling segment as a descendant", () => {
    expect(resolveShellKind("/trainers")).toBe("public");
    expect(resolveShellKind("/reports-archive")).toBe("public");
  });

  it("gives the auth shell to the public credential screens", () => {
    expect(resolveShellKind("/login")).toBe("auth");
    expect(resolveShellKind("/forgot-password")).toBe("auth");
    // All three, without exception: `/reset-password` used to fall through to
    // "public" and got the top header stacked over its own composition.
    expect(resolveShellKind("/reset-password")).toBe("auth");
  });

  it("treats /unauthorized as its own screen, not a top-nav page", () => {
    expect(resolveShellKind("/unauthorized")).toBe("standalone");
  });

  it("leaves the landing and unknown routes on public chrome", () => {
    expect(resolveShellKind("/")).toBe("public");
    expect(resolveShellKind("/contacto")).toBe("public");
  });
});

describe("hidesTopHeader", () => {
  it("hides the top header on every route that owns its chrome", () => {
    expect(hidesTopHeader("/dashboard")).toBe(true);
    expect(hidesTopHeader("/student/add-dependent")).toBe(true);
    expect(hidesTopHeader("/login")).toBe(true);
    expect(hidesTopHeader("/unauthorized")).toBe(true);
  });

  it("keeps the top header on public routes", () => {
    expect(hidesTopHeader("/")).toBe(false);
    expect(hidesTopHeader("/contacto")).toBe(false);
  });

  it("hides the top header on the enrollment wizard", () => {
    expect(hidesTopHeader("/student/enroll")).toBe(true);
    expect(hidesTopHeader("/student/enroll/step")).toBe(true);
  });
});
