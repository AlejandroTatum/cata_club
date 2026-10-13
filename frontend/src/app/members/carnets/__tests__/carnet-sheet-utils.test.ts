import { describe, expect, it } from "vitest";
import type { CarnetSummary } from "@/services/api";
import type { MemberAccount } from "@/app/members/members-utils";
import {
  describeMiembroDesde,
  hasUndatedPlayer,
  withAccountMiembroDesde,
  withMiembroDesde,
} from "@/app/members/carnets/carnet-sheet-utils";

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

describe("describeMiembroDesde (#1749)", () => {
  it("names the month and year on record, or says there is no date", () => {
    expect(describeMiembroDesde("2019-03-01")).toBe("Miembro desde mar 2019");
    expect(describeMiembroDesde(null)).toBe("Sin fecha");
    expect(describeMiembroDesde(undefined)).toBe("Sin fecha");
  });
});

describe("withAccountMiembroDesde (#1749)", () => {
  const account = (id: string, miembroDesde?: string | null): MemberAccount => ({
    id,
    role: "estudiante",
    nombres: "Ana",
    apellidos: "Vera",
    telefono: "1",
    estudiantes: [],
    miembroDesde,
  });

  it("replaces only the chosen account and keeps every other one as the same object", () => {
    const first = account("1", "2019-03-01");
    const result = withAccountMiembroDesde([first, account("2")], "2", "2021-07-01");

    expect(result[0]).toBe(first);
    expect(result[1].miembroDesde).toBe("2021-07-01");
    expect(withAccountMiembroDesde([first], "1", null)[0].miembroDesde).toBeNull();
  });
});

describe("hasUndatedPlayer (#1749)", () => {
  it("is true when at least one carnet has no «Miembro desde»", () => {
    expect(hasUndatedPlayer([carnet("1", "2019-03-01"), carnet("2")])).toBe(true);
    expect(hasUndatedPlayer([carnet("1", "2019-03-01"), carnet("2", "2020-01-01")])).toBe(false);
    expect(hasUndatedPlayer([])).toBe(false);
  });
});
