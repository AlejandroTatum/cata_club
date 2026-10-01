import { describe, expect, it } from "vitest";
import type { ReporteError } from "@/services/api";
import { applyFilter, buildChips, summarize } from "../inbox";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
const make = (id: number, over: Partial<ReporteError>): ReporteError => ({
  id, persona_id: 1, descripcion: "x", request_id: null, ruta: null, user_agent: null, captura_mime: null,
  fecha_creacion: "2026-09-29T10:00:00Z", ...over,
});
const reports = [
  make(1, { ruta: "/perfil", user_agent: CHROME }),
  make(2, { ruta: "/perfil", user_agent: CHROME, fecha_creacion: "2026-09-01T10:00:00" }),
  make(3, { ruta: "/pagos", user_agent: FIREFOX }),
  make(4, {}),
];

describe("inbox helpers", () => {
  it("summarizes totals, the last 7 days, and the most frequent route and device", () => {
    expect(summarize(reports, NOW)).toEqual({
      total: 4, lastWeek: 3,
      topRoute: { value: "/perfil", count: 2 },
      topDevice: { value: "Chrome · Linux", count: 2 },
    });
  });
  it("has no top route or device when no report carries one", () => {
    const summary = summarize([make(1, {})], NOW);
    expect(summary.topRoute).toBeNull();
    expect(summary.topDevice).toBeNull();
  });
  it("offers Todos, Últimos 7 días and the busiest routes with their counts", () => {
    expect(buildChips(reports, NOW).map((c) => [c.label, c.count])).toEqual([
      ["Todos", 4], ["Últimos 7 días", 3], ["/perfil", 2], ["/pagos", 1],
    ]);
  });
  it("filters by window and by route", () => {
    expect(applyFilter(reports, "todos", NOW)).toHaveLength(4);
    expect(applyFilter(reports, "7d", NOW).map((r) => r.id)).toEqual([1, 3, 4]);
    expect(applyFilter(reports, "ruta:/perfil", NOW).map((r) => r.id)).toEqual([1, 2]);
  });
});
