import { describe, expect, it } from "vitest";
import { activationPendingReasons } from "../activation-reasons";

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
