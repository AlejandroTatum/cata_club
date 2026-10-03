/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WeekOverview from "../WeekOverview";
import type { ScheduleDayGroup } from "@/app/attendance/attendance-utils";

const GROUPS: ScheduleDayGroup[] = [
  {
    day: "lun",
    label: "Lunes",
    schedules: [
      { id: 1, diaSemana: "lun", horaInicio: "15:00", horaFin: "16:00" },
      { id: 2, diaSemana: "lun", horaInicio: "16:00", horaFin: "17:00" },
    ],
  },
  { day: "mar", label: "Martes", schedules: [{ id: 3, diaSemana: "mar", horaInicio: "18:00", horaFin: "19:00" }] },
];

describe("WeekOverview", () => {
  it("counts the sessions still without a list per day", () => {
    render(<WeekOverview dayGroups={GROUPS} today="mar" closedHorarios={new Set([1])} onSelectDay={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Ver lunes: 2 horarios, 1 con lista" })).toHaveTextContent("1 por tomar");
    expect(screen.getByRole("button", { name: "Ver martes: 1 horario, 0 con lista" })).toHaveTextContent("1 por tomar");
    expect(screen.getByText("Hoy")).toBeInTheDocument();
  });

  it("says a day is done once every session has a list", () => {
    render(<WeekOverview dayGroups={GROUPS} today="lun" closedHorarios={new Set([3])} onSelectDay={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Ver martes/ })).toHaveTextContent("todas con lista");
  });

  it("does not count a partially recorded list as taken (ENT-03)", () => {
    // Horario 1 has records but is not closed: it is still pending.
    render(<WeekOverview dayGroups={GROUPS} today="mar" closedHorarios={new Set()} onSelectDay={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Ver lunes: 2 horarios, 0 con lista" })).toHaveTextContent("2 por tomar");
  });

  it("jumps to the day that was clicked", () => {
    const onSelectDay = vi.fn();
    render(<WeekOverview dayGroups={GROUPS} today="lun" closedHorarios={new Set()} onSelectDay={onSelectDay} />);

    fireEvent.click(screen.getByRole("button", { name: /Ver martes/ }));
    expect(onSelectDay).toHaveBeenCalledWith("mar");
  });

  it("renders nothing without schedules", () => {
    const { container } = render(<WeekOverview dayGroups={[]} today="lun" closedHorarios={new Set()} onSelectDay={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
