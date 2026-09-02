import { describe, expect, it } from "vitest";
import { activationPendingReasons, isActivationComplete } from "../activation-reasons";

const session = (
  correoVerificado: boolean,
  altaPresencialCompletada: boolean,
): Parameters<typeof activationPendingReasons>[0] => ({
  user: {
    id: "1",
    name: "Ana Torres",
    email: "ana@example.com",
    role: "estudiante" as const,
    activo: true,
    representanteId: null,
  },
  roles: ["ALUMNO"],
  loggedInAt: "2026-01-01T00:00:00.000Z",
  correoVerificado,
  altaPresencialCompletada,
});

describe("activationPendingReasons", () => {
  it.each([
    [false, false, ["correo", "inscripcion"]],
    [true, false, ["inscripcion"]],
    [false, true, ["correo"]],
    [true, true, []],
  ] as const)("reports the exact pending conditions for %s/%s", (correo, alta, expected) => {
    expect(activationPendingReasons(session(correo, alta))).toEqual(expected);
  });

  it("keeps legacy sessions compatible when activation fields are absent", () => {
    const legacy = session(true, true);
    delete (legacy as { correoVerificado?: boolean }).correoVerificado;
    delete (legacy as { altaPresencialCompletada?: boolean }).altaPresencialCompletada;

    expect(activationPendingReasons(legacy)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isActivationComplete (issue #940) — the backend's decision rules, never a
// recombination of the two facts above.
// ---------------------------------------------------------------------------

describe("isActivationComplete", () => {
  it("wins with a true decision even when alta presencial is incomplete (admin/entrenador without membership)", () => {
    expect(
      isActivationComplete({ ...session(true, false), activacionCompleta: true }),
    ).toBe(true);
  });

  it("wins with a false decision even when both facts are true", () => {
    expect(
      isActivationComplete({ ...session(true, true), activacionCompleta: false }),
    ).toBe(false);
  });

  it("falls back to the two facts when the decision is absent (pre-#940 backend)", () => {
    expect(isActivationComplete(session(true, false))).toBe(false);
    expect(isActivationComplete(session(false, true))).toBe(false);
  });

  it("is complete when the decision and both facts are all absent", () => {
    const legacy = session(true, true);
    delete (legacy as { correoVerificado?: boolean }).correoVerificado;
    delete (legacy as { altaPresencialCompletada?: boolean }).altaPresencialCompletada;

    expect(isActivationComplete(legacy)).toBe(true);
  });
});
