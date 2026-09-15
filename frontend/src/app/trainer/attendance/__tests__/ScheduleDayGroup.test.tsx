/**
 * ScheduleDayGroup — issue #1238.
 *
 * The picker's schedule cards used to print only the time range, so five
 * same-day cards from five different categories read as five copies of the
 * same card. `TrainingSchedule.categoriaLabel` (see attendance-utils.ts) now
 * travels the category's human name alongside the time range; this file
 * locks the card down to rendering it, and to still rendering cleanly when a
 * schedule has none.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ScheduleDayGroup from "../ScheduleDayGroup";
import type { ScheduleDayGroup as ScheduleDayGroupData, TrainingSchedule } from "@/app/attendance/attendance-utils";

function buildSchedule(overrides: Partial<TrainingSchedule> = {}): TrainingSchedule {
  return {
    id: 1,
    diaSemana: "mar",
    horaInicio: "18:00",
    horaFin: "20:00",
    categoriaLabel: "Competitivo",
    ...overrides,
  };
}

function buildGroup(schedules: TrainingSchedule[]): ScheduleDayGroupData {
  return { day: "mar", label: "Martes", schedules };
}

const noop = () => {};

describe("ScheduleDayGroup", () => {
  it("renders the category label alongside the time range", () => {
    render(
      <ScheduleDayGroup
        group={buildGroup([buildSchedule({ categoriaLabel: "Competitivo" })])}
        today="mar"
        isExpanded
        onToggle={noop}
        selectedScheduleId={null}
        onSelectSchedule={vi.fn()}
        weekRecordCounts={new Map()}
      />,
    );

    expect(screen.getByText("Competitivo")).toBeInTheDocument();
    expect(screen.getByText("18:00 — 20:00")).toBeInTheDocument();
  });

  it("still renders a schedule whose category label is missing", () => {
    render(
      <ScheduleDayGroup
        group={buildGroup([buildSchedule({ categoriaLabel: undefined })])}
        today="mar"
        isExpanded
        onToggle={noop}
        selectedScheduleId={null}
        onSelectSchedule={vi.fn()}
        weekRecordCounts={new Map()}
      />,
    );

    expect(screen.getByText("18:00 — 20:00")).toBeInTheDocument();
  });

  it("tells apart two same-time-range cards from different categories", () => {
    render(
      <ScheduleDayGroup
        group={buildGroup([
          buildSchedule({ id: 1, categoriaLabel: "Competitivo" }),
          buildSchedule({ id: 2, categoriaLabel: "Adultos" }),
        ])}
        today="mar"
        isExpanded
        onToggle={noop}
        selectedScheduleId={null}
        onSelectSchedule={vi.fn()}
        weekRecordCounts={new Map()}
      />,
    );

    expect(screen.getByText("Competitivo")).toBeInTheDocument();
    expect(screen.getByText("Adultos")).toBeInTheDocument();
  });
});
