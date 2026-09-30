/**
 * "Esta semana" as a compact week: seven fixed days with the training days lit
 * and dated, the time stated once when every session shares it, and the next
 * session spelled out.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import WeekPlan from "@/app/student/WeekPlan";
import type { UpcomingTraining } from "@/app/student/student-utils";

function session(dia: UpcomingTraining["dia"], diaLabel: string, fecha: string, horaInicio: string, horaFin: string, isToday = false): UpcomingTraining {
  return { dia, diaLabel, fecha, horaInicio, horaFin, isToday } as UpcomingTraining;
}

const SAME_TIME = [
  session("MIERCOLES", "Miércoles", "2026-09-30", "20:00", "21:15", true),
  session("JUEVES", "Jueves", "2026-10-01", "20:00", "21:15"),
  session("VIERNES", "Viernes", "2026-10-02", "20:00", "21:15"),
  session("LUNES", "Lunes", "2026-10-05", "20:00", "21:15"),
  session("MARTES", "Martes", "2026-10-06", "20:00", "21:15"),
];

describe("WeekPlan", () => {
  it("draws seven fixed days and lights only the ones that train", () => {
    render(<WeekPlan sessions={SAME_TIME} />);
    const days = within(screen.getByTestId("week-plan")).getAllByRole("listitem");
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.getAttribute("data-state"))).toEqual([
      "active", "active", "next", "active", "active", "idle", "idle",
    ].map((_, i) => (i === 2 ? "next" : i < 5 ? "active" : "idle")));
  });

  it("shows the date on each training day", () => {
    render(<WeekPlan sessions={SAME_TIME} />);
    const thursday = screen.getByTestId("week-plan").querySelector('[data-day="JUEVES"]') as HTMLElement;
    expect(thursday).toHaveTextContent("01");
    expect(thursday).toHaveAccessibleName(/Jueves 01\/10\/2026/);
  });

  it("states the time once when every session shares it", () => {
    render(<WeekPlan sessions={SAME_TIME} />);
    expect(screen.getAllByText("20:00 – 21:15")).toHaveLength(1);
    expect(screen.getByTestId("week-plan-time")).toHaveTextContent("20:00 – 21:15");
  });

  it("puts the time on each day when sessions differ", () => {
    render(
      <WeekPlan
        sessions={[
          session("MARTES", "Martes", "2026-10-06", "18:00", "19:00"),
          session("JUEVES", "Jueves", "2026-10-08", "20:00", "21:15"),
        ]}
      />,
    );
    expect(screen.queryByTestId("week-plan-time")).toBeNull();
    const tuesday = screen.getByTestId("week-plan").querySelector('[data-day="MARTES"]') as HTMLElement;
    expect(tuesday).toHaveTextContent("18:00");
    expect(tuesday).toHaveAccessibleName(/18:00 – 19:00/);
  });

  it("spells out the next session, and says Hoy when it is today", () => {
    render(<WeekPlan sessions={SAME_TIME} />);
    expect(screen.getByTestId("week-plan-next")).toHaveTextContent(/Próximo: hoy, miércoles 30\/09 · 20:00 – 21:15/i);
  });

  it("names the next session by weekday and date when it is not today", () => {
    render(<WeekPlan sessions={SAME_TIME.slice(1)} />);
    expect(screen.getByTestId("week-plan-next")).toHaveTextContent("Próximo: jueves 01/10 · 20:00 – 21:15");
  });
});
