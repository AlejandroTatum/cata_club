import { describe, expect, it } from "vitest";
import { daysUntil, roleBlocksFor, ticketTone, ticketWord } from "@/app/profile/ProfileParts";

describe("roleBlocksFor — which block each role draws", () => {
  it("jugador: the ticket, and only when there is a membership to talk about", () => {
    expect(roleBlocksFor("estudiante", true)).toEqual(["ticket"]);
    expect(roleBlocksFor("estudiante", false)).toEqual([]);
  });

  it("representante: «A tu cargo» always, then their own ticket when they hold a membership", () => {
    expect(roleBlocksFor("representante", false)).toEqual(["dependants"]);
    expect(roleBlocksFor("representante", true)).toEqual(["dependants", "ticket"]);
  });

  it("entrenador and administrador: their own coal board, whatever the membership says", () => {
    expect(roleBlocksFor("trainer", false)).toEqual(["trainer-board"]);
    expect(roleBlocksFor("trainer", true)).toEqual(["trainer-board"]);
    expect(roleBlocksFor("admin", false)).toEqual(["admin-board"]);
    expect(roleBlocksFor("admin", true)).toEqual(["admin-board"]);
  });

  it("an unrecognised role still gets a board", () => {
    expect(roleBlocksFor("unsupported", false)).toEqual(["account-board"]);
  });
});

describe("ticketTone / ticketWord — the ticket never disagrees with the status chip", () => {
  it("reassures only when both the dates and the chip do", () => {
    expect(ticketTone(24, "ok")).toBe("ok");
    expect(ticketTone(null, "ok")).toBe("ok");
    expect(ticketTone(24, "neutral")).toBe("ok");
  });

  it("warns in the last week, or when the chip warns", () => {
    expect(ticketTone(7, "ok")).toBe("warn");
    expect(ticketTone(8, "ok")).toBe("ok");
    expect(ticketTone(24, "warn")).toBe("warn");
  });

  it("goes red once lapsed, or when the chip is red, even with days to spare", () => {
    expect(ticketTone(-1, "ok")).toBe("bad");
    expect(ticketTone(24, "bad")).toBe("bad");
    expect(ticketTone(3, "bad")).toBe("bad");
  });

  it("says one word for the standing", () => {
    expect(ticketWord("ok", 24, "Membresía activa")).toBe("Al día");
    expect(ticketWord("warn", 5, "Membresía activa")).toBe("Vence pronto");
    expect(ticketWord("warn", null, "Sin pagos aprobados")).toBe("Sin pagos aprobados");
    expect(ticketWord("bad", -2, "Cobertura vencida")).toBe("Venció");
    expect(ticketWord("bad", 10, "Suspendida")).toBe("Suspendida");
  });
});

describe("daysUntil", () => {
  it("counts calendar days, negative once past", () => {
    const today = new Date(2026, 9, 4, 23, 30);
    expect(daysUntil("2026-10-28", today)).toBe(24);
    expect(daysUntil("2026-10-04", today)).toBe(0);
    expect(daysUntil("2026-10-01", today)).toBe(-3);
  });
});
