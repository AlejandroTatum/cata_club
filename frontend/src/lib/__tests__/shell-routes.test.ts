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

describe("resolveShellKind", () => {
  it("gives the app shell to every admin section root", () => {
    for (const route of [
      "/dashboard",
      "/members",
      "/ranking",
      "/groups",
      "/payments",
      "/attendance",
      "/reports",
      "/trainer",
      "/student",
      "/profile",
    ]) {
      expect(resolveShellKind(route)).toBe("app");
    }
  });

  it("keeps the app shell for descendants of an app section", () => {
    expect(resolveShellKind("/trainer/attendance")).toBe("app");
    expect(resolveShellKind("/trainer/nivel")).toBe("app");
    expect(resolveShellKind("/student/add-dependent")).toBe("app");
  });

  it("keeps /student/enroll public even though it sits under /student", () => {
    expect(resolveShellKind("/student/enroll")).toBe("public");
    expect(resolveShellKind("/student/enroll/step")).toBe("public");
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
    expect(hidesTopHeader("/student/enroll")).toBe(false);
  });
});
