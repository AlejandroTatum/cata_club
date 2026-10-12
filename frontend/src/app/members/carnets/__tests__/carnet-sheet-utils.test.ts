import { describe, expect, it } from "vitest";
import type { CarnetSummary } from "@/services/api";
import { withMiembroDesde } from "@/app/members/carnets/carnet-sheet-utils";

function carnet(id: string, miembroDesde: string | null = null): CarnetSummary {
  return {
    profile: {
      personaId: id,
      nombres: "Ana",
      apellidos: "Vera",
      fechaNacimiento: "2012-01-01",
      recentSessions: [],
      representante: null,
      representanteId: null,
      membership: null,
      miembroDesde,
    },
    coverageEnd: null,
    asignaciones: [],
  };
}

describe("withMiembroDesde (#1749)", () => {
  it("replaces only the chosen player's value and leaves the others as the same objects", () => {
    const first = carnet("1", "2019-03-01");
    const second = carnet("2");

    const result = withMiembroDesde([first, second], "2", "2021-07-01");

    expect(result[0]).toBe(first);
    expect(result[1].profile.miembroDesde).toBe("2021-07-01");
  });

  it("clears with null", () => {
    expect(withMiembroDesde([carnet("1", "2019-03-01")], "1", null)[0].profile.miembroDesde).toBeNull();
  });
});
