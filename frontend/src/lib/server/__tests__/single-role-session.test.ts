/**
 * The frontend half of issue #762 — exactly one active role per account.
 *
 * Since #785 the database refuses to store a second role on an account, so a
 * `/auth/me` response carrying two of them is an IMPOSSIBLE state. Legacy
 * accounts predating that trigger still exist (the migration detects them and
 * deliberately corrects nothing), which is why this path is reachable in
 * production today and why it is tested here rather than assumed away.
 *
 * What the frontend used to do with such a response was pick a winner by
 * precedence and carry the raw array alongside it — two different readings of
 * the same account, which is the whole of the reported "sale error pero igual
 * me deja". The session is refused now: there is no role to guess.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { buildSession, resolveSessionRole } from "@/lib/server/auth";

function me(roles: string[], extra: Record<string, unknown> = {}) {
  return {
    correo: "persona@cataclub.com",
    personaId: 1,
    nombres: "Ana",
    apellidos: "Torres",
    roles,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// resolveSessionRole
// ---------------------------------------------------------------------------

describe("resolveSessionRole", () => {
  it("resolves each backend role to its own frontend role", () => {
    expect(resolveSessionRole(["ADMINISTRADOR"])).toEqual({ ok: true, role: "admin" });
    expect(resolveSessionRole(["ENTRENADOR"])).toEqual({ ok: true, role: "trainer" });
    expect(resolveSessionRole(["REPRESENTANTE"])).toEqual({ ok: true, role: "representante" });
    expect(resolveSessionRole(["ALUMNO"])).toEqual({ ok: true, role: "estudiante" });
  });

  it('resolves an account with no recognized role to "unsupported"', () => {
    expect(resolveSessionRole([])).toEqual({ ok: true, role: "unsupported" });
    expect(resolveSessionRole(["SUPERADMIN"])).toEqual({ ok: true, role: "unsupported" });
    expect(resolveSessionRole(["", "GHOST_ROLE"])).toEqual({ ok: true, role: "unsupported" });
  });

  it("ignores unrecognized roles sitting beside a recognized one", () => {
    expect(resolveSessionRole(["GHOST_ROLE", "ENTRENADOR"])).toEqual({ ok: true, role: "trainer" });
  });

  it("reads the same role twice as the one role it is", () => {
    expect(resolveSessionRole(["ALUMNO", "ALUMNO"])).toEqual({ ok: true, role: "estudiante" });
  });

  /**
   * The three combinations the issue names, plus the one the staging
   * inventory actually found. Every one of them used to answer with a role.
   */
  it.each([
    ["ADMINISTRADOR", "ENTRENADOR"],
    ["ENTRENADOR", "ALUMNO"],
    ["ENTRENADOR", "REPRESENTANTE"],
    ["ADMINISTRADOR", "ALUMNO"],
    ["REPRESENTANTE", "ALUMNO"],
  ])("refuses to pick between %s and %s", (first, second) => {
    expect(resolveSessionRole([first, second])).toEqual({ ok: false, reason: "multiple_roles" });
    // Order is not a tie-break, because there is no tie-break.
    expect(resolveSessionRole([second, first])).toEqual({ ok: false, reason: "multiple_roles" });
  });

  it("refuses an account holding all four roles", () => {
    expect(resolveSessionRole(["ALUMNO", "REPRESENTANTE", "ENTRENADOR", "ADMINISTRADOR"])).toEqual({
      ok: false,
      reason: "multiple_roles",
    });
  });
});

// ---------------------------------------------------------------------------
// buildSession — the only place a /auth/me response becomes a browser session
// ---------------------------------------------------------------------------

describe("buildSession — single-role invariant", () => {
  it("builds a session for an account with exactly one role", () => {
    const result = buildSession(me(["ENTRENADOR"]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.user.role).toBe("trainer");
    expect(result.session.roles).toEqual(["ENTRENADOR"]);
  });

  it("builds a session for an account with no recognized role", () => {
    const result = buildSession(me([]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.user.role).toBe("unsupported");
  });

  it("refuses a multi-role account instead of collapsing it to one role", () => {
    expect(buildSession(me(["ADMINISTRADOR", "ENTRENADOR"]))).toEqual({
      ok: false,
      reason: "multiple_roles",
    });
  });

  /**
   * The refusal carries no session at all — not one with a role stripped out,
   * not one with an empty `roles` array. A caller that forgets to check `ok`
   * gets a type error, not a half-built identity.
   */
  it("carries no session on the refusal", () => {
    const result = buildSession(me(["ENTRENADOR", "REPRESENTANTE"]));

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("session");
  });

  /**
   * The age gate at `AppShell.tsx` reads `fechaNacimiento`, which
   * `buildSession` only writes on the estudiante branch. Under the old
   * collapse an ALUMNO+ADMINISTRADOR account resolved to "admin" and so
   * carried no birth date at all — the gate could not fire, silently, for a
   * person who does hold ALUMNO. There is no session for that account now, so
   * the gate has nothing to be silent about; a real ALUMNO still gets the date.
   */
  it("still carries fechaNacimiento for a single-role estudiante", () => {
    const result = buildSession(me(["ALUMNO"], { fechaNacimiento: "1990-05-20" }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.user).toMatchObject({ role: "estudiante", fechaNacimiento: "1990-05-20" });
  });

  it("produces no session at all for the ALUMNO+ADMINISTRADOR account the age gate used to lose", () => {
    expect(buildSession(me(["ALUMNO", "ADMINISTRADOR"], { fechaNacimiento: "2015-05-20" })).ok).toBe(
      false,
    );
  });
});
