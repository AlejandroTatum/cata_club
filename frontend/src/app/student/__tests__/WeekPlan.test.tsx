/**
 * "Esta semana" as a compact week: seven fixed days with the training days lit
 * and dated, the time stated once when every session shares it, and the next
 * session spelled out.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import WeekPlan from "@/app/student/WeekPlan";
import { findNextTrainingSessions, type UpcomingTraining, type WeeklyTrainingSlot } from "@/app/student/student-utils";

function session(dia: UpcomingTraining["dia"], diaLabel: string, fecha: string, horaInicio: string, horaFin: string, isToday = false): UpcomingTraining {
  return { dia, diaLabel, fecha, horaInicio, horaFin, isToday } as UpcomingTraining;
}

const NOW = new Date("2026-09-30T12:00:00-05:00");
const SAME_TIME = [
  session("MIERCOLES", "Miércoles", "2026-09-30", "20:00", "21:15", true),
  session("JUEVES", "Jueves", "2026-10-01", "20:00", "21:15"),
  session("VIERNES", "Viernes", "2026-10-02", "20:00", "21:15"),
  session("LUNES", "Lunes", "2026-10-05", "20:00", "21:15"),
  session("MARTES", "Martes", "2026-10-06", "20:00", "21:15"),
];

describe("WeekPlan", () => {
  it("draws seven fixed days and lights only the ones that train", () => {
    render(<WeekPlan sessions={SAME_TIME} now={NOW} />);
    const days = within(screen.getByTestId("week-plan")).getAllByRole("listitem");
    expect(days).toHaveLength(7);
    // L M X(next: today) J V S D
    expect(days.map((d) => d.getAttribute("data-state"))).toEqual([
      "active", "active", "next", "active", "active", "idle", "idle",
    ]);
  });

  it("shows the date on each training day", () => {
    render(<WeekPlan sessions={SAME_TIME} now={NOW} />);
    const thursday = screen.getByTestId("week-plan").querySelector('[data-day="JUEVES"]') as HTMLElement;
    expect(thursday).toHaveTextContent("01");
    expect(thursday).toHaveAccessibleName(/Jueves 01\/10\/2026/);
  });

  it("states the time once when every session shares it, and only says the rest is the same", () => {
    render(<WeekPlan sessions={SAME_TIME} now={NOW} />);
    // Once, in the next-session line; the days carry no time of their own.
    expect(screen.getAllByText(/20:00 – 21:15/)).toHaveLength(1);
    // Folded into the "Próximo" line instead of a line of its own.
    expect(screen.getByTestId("week-plan-next")).toContainElement(screen.getByTestId("week-plan-same-time"));
    expect(screen.getByTestId("week-plan-same-time")).toHaveTextContent(/mismo horario/i);
    expect(screen.getByTestId("week-plan").querySelector('[data-day="JUEVES"]')).not.toHaveTextContent("20:00");
  });

  it("puts the time on each day when sessions differ", () => {
    render(
      <WeekPlan
        now={NOW}
        sessions={[
          session("MARTES", "Martes", "2026-10-06", "18:00", "19:00"),
          session("JUEVES", "Jueves", "2026-10-08", "20:00", "21:15"),
        ]}
      />,
    );
    expect(screen.queryByTestId("week-plan-same-time")).toBeNull();
    const tuesday = screen.getByTestId("week-plan").querySelector('[data-day="MARTES"]') as HTMLElement;
    expect(tuesday).toHaveTextContent("18:00");
    expect(tuesday).toHaveAccessibleName(/18:00 – 19:00/);
  });

  it("spells out the next session, and says Hoy when it is today", () => {
    render(<WeekPlan sessions={SAME_TIME} now={NOW} />);
    expect(screen.getByTestId("week-plan-next")).toHaveTextContent(/Próximo: hoy, miércoles 30\/09 · 20:00 – 21:15/i);
  });

  it("names the next session by weekday and date when it is not today", () => {
    render(<WeekPlan sessions={SAME_TIME.slice(1)} now={NOW} />);
    expect(screen.getByTestId("week-plan-next")).toHaveTextContent("Próximo: jueves 01/10 · 20:00 – 21:15");
  });
});

// ---------------------------------------------------------------------------
// One calendar week, Monday to Sunday
// ---------------------------------------------------------------------------

const MON_TO_FRI = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"].map(
  (dia) => ({ dia, diaLabel: dia, horaInicio: "20:00", horaFin: "21:15" }) as WeeklyTrainingSlot,
);
const DAYS = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"];

function renderAt(iso: string) {
  const now = new Date(iso);
  render(<WeekPlan sessions={findNextTrainingSessions(MON_TO_FRI, MON_TO_FRI.length, now)} now={now} />);
  const cells = within(screen.getByTestId("week-plan")).getAllByRole("listitem");
  return { cells, dates: cells.map((c) => c.getAttribute("data-date")) };
}

describe("WeekPlan — the strip is one calendar week", () => {
  afterEach(() => vi.useRealTimers());

  it("on a Wednesday shows Mon 28/09 … Sun 04/10 in order, dated and consecutive", () => {
    const { cells, dates } = renderAt("2026-09-30T12:00:00-05:00");
    expect(cells.map((c) => c.getAttribute("data-day"))).toEqual(DAYS);
    expect(dates).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    // Every cell carries its date, trained or not.
    expect(cells.map((c) => c.textContent?.replace(/\D/g, "").slice(0, 2))).toEqual(["28", "29", "30", "01", "02", "03", "04"]);
  });

  it("marks today, mutes the days already gone and keeps the next session red", () => {
    const { cells } = renderAt("2026-09-30T12:00:00-05:00");
    expect(cells.map((c) => c.getAttribute("data-today"))).toEqual(["false", "false", "true", "false", "false", "false", "false"]);
    expect(cells.map((c) => c.getAttribute("data-past"))).toEqual(["true", "true", "false", "false", "false", "false", "false"]);
    expect(cells.map((c) => c.getAttribute("data-state"))).toEqual(["active", "active", "next", "active", "active", "idle", "idle"]);
  });

  it("on a Sunday shows the week that ends today, and says the next session is next week with its date", () => {
    const { cells, dates } = renderAt("2026-10-04T12:00:00-05:00");
    expect(dates).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    expect(cells.map((c) => c.getAttribute("data-today"))).toEqual(["false", "false", "false", "false", "false", "false", "true"]);
    // Nothing left to train this week: no cell is `next`, and the line names the date.
    expect(cells.map((c) => c.getAttribute("data-state"))).not.toContain("next");
    expect(screen.getByTestId("week-plan-next")).toHaveTextContent("Próximo: lunes 05/10 · 20:00 – 21:15");
  });

  it("uses the Guayaquil calendar day, not UTC, near midnight", () => {
    // 23:30 in Guayaquil on Sunday 04/10 is already Monday 05/10 in UTC.
    const { dates, cells } = renderAt("2026-10-04T23:30:00-05:00");
    expect(dates[0]).toBe("2026-09-28");
    expect(cells[6].getAttribute("data-today")).toBe("true");
  });
});
