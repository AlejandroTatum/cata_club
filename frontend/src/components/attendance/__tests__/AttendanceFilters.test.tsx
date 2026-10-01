/**
 * A shared panel that forgets its own styling when a caller adjusts one detail
 * is a silent trap: nothing errors, the panel just comes out misaligned.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import AttendanceFilters, {
  type AttendanceFiltersController,
} from "@/components/attendance/AttendanceFilters";
import type { PersonaBusqueda } from "@/types/domain";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";

// The panel is what is under test; the student typeahead pulls in the API layer
// and answers a different question. The seam mirrors the shared primitive's own
// contract (issue #200): its clear control must reach the parent's `onClear`.
vi.mock("@/components/StudentSearch", () => ({
  default: ({
    onClear,
  }: {
    onSelect?: (alumno: unknown) => void;
    onClear?: () => void;
  }): React.ReactElement => (
    <div>
      <input aria-label="Buscar alumno" />
      <button type="button" onClick={onClear}>
        clear search
      </button>
    </div>
  ),
}));

const ALUMNO: PersonaBusqueda = { id: 42, nombres: "Ana", apellidos: "García" };

const controller: AttendanceFiltersController = {
  preset: "this_month",
  setPreset: () => {},
  customStart: "",
  setCustomStart: () => {},
  customEnd: "",
  setCustomEnd: () => {},
  rangeError: null,
  slotKey: null,
  setSlotKey: () => {},
  dayId: null,
  setDayId: () => {},
  student: null,
  selectStudent: () => {},
  clearStudent: () => {},
  query: null,
};

function renderPanel(className?: string): HTMLElement {
  render(<AttendanceFilters filters={controller} schedules={[]} className={className} />);
  return screen.getByRole("region", { name: "Filtros de registros" });
}

afterEach(cleanup);

/**
 * The classes that make the panel read as a panel, whatever the caller says.
 *
 * `card` and not `rounded-card border border-line bg-paper`: the product had
 * two spellings for the same paper surface and this was one of the twenty-one
 * sites on the assembled side. See `lib/__tests__/card-idiom.test.ts`.
 */
const BASE_CLASSES = ["flex", "flex-col", "gap-4", "card", "p-[18px]"];

describe("AttendanceFilters container styling", () => {
  it("carries its own panel classes when the caller passes nothing", () => {
    const panel = renderPanel();

    for (const cls of BASE_CLASSES) {
      expect(panel.className.split(" ")).toContain(cls);
    }
  });

  it("keeps its base classes when the caller names only one extra", () => {
    const panel = renderPanel("mt-4");

    expect(panel.className.split(" ")).toContain("mt-4");
    for (const cls of BASE_CLASSES) {
      expect(panel.className.split(" ")).toContain(cls);
    }
  });

  it("owns no vertical margin — the page rhythm belongs to the shell's gap", () => {
    // `<main>` in `AppShell` is `flex flex-col gap-page`, so a margin here is
    // added ON TOP of the 20px step rather than replacing it. The trainer's
    // history used to re-declare the whole base class string just to drop it.
    const panel = renderPanel();

    expect(panel.className).not.toMatch(/\bm[btly]?-/);
  });
});

describe("AttendanceFilters — alumno clear contract (issue #200)", () => {
  it("offers no separate clear action — the search's own control is the only one", () => {
    render(<AttendanceFilters filters={{ ...controller, student: ALUMNO }} schedules={[]} />);

    expect(screen.queryByRole("button", { name: /limpiar selección/i })).not.toBeInTheDocument();
  });

  it("wires the search's own clear to drop the selected student", () => {
    const clearStudent = vi.fn();
    render(
      <AttendanceFilters filters={{ ...controller, student: ALUMNO, clearStudent }} schedules={[]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));

    expect(clearStudent).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Horario select grouping (issue A1) — shared by /attendance and
// /trainer/attendance/history, both of which pass the same flat schedule
// list, so the grouping lives here rather than in either caller.
// ---------------------------------------------------------------------------

function buildSchedule(overrides: Partial<TrainingSchedule> = {}): TrainingSchedule {
  return {
    id: 1,
    diaSemana: "lun",
    horaInicio: "15:00",
    horaFin: "16:30",
    categoriaLabel: "Competitivo",
    ...overrides,
  };
}

describe("AttendanceFilters — schedule first, then the day", () => {
  const schedules = [
    buildSchedule({ id: 1, diaSemana: "vie", horaInicio: "17:00", horaFin: "18:00" }),
    buildSchedule({ id: 2, diaSemana: "lun", horaInicio: "17:00", horaFin: "18:00" }),
    buildSchedule({ id: 3, diaSemana: "lun", horaInicio: "15:00", horaFin: "16:00" }),
    buildSchedule({ id: 4, diaSemana: "lun", horaInicio: "15:00", horaFin: "16:00", categoriaLabel: "Recreativo" }),
  ];

  it("lists each slot once, deduped across days, behind 'Todos los horarios'", () => {
    render(<AttendanceFilters filters={controller} schedules={schedules} />);

    const select = screen.getByLabelText("Filtrar por horario");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos los horarios",
      "Competitivo · 15:00–16:00",
      "Competitivo · 17:00–18:00",
      "Recreativo · 15:00–16:00",
    ]);
  });

  it("keeps the day select disabled until a slot is chosen", () => {
    render(<AttendanceFilters filters={controller} schedules={schedules} />);

    expect(screen.getByLabelText("Filtrar por día")).toBeDisabled();
  });

  it("enables the day select with that slot's days, Monday first", () => {
    render(
      <AttendanceFilters
        filters={{ ...controller, slotKey: "Competitivo|17:00|18:00" }}
        schedules={schedules}
      />,
    );

    const day = screen.getByLabelText("Filtrar por día");
    expect(day).toBeEnabled();
    expect(within(day).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos los días",
      "Lunes",
      "Viernes",
    ]);
  });

  it("reports the slot key and the day's horario id when chosen", () => {
    const setSlotKey = vi.fn();
    const setDayId = vi.fn();
    render(
      <AttendanceFilters
        filters={{ ...controller, slotKey: "Competitivo|17:00|18:00", setSlotKey, setDayId }}
        schedules={schedules}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filtrar por horario"), {
      target: { value: "Recreativo|15:00|16:00" },
    });
    fireEvent.change(screen.getByLabelText("Filtrar por día"), { target: { value: "1" } });

    expect(setSlotKey).toHaveBeenCalledWith("Recreativo|15:00|16:00");
    expect(setDayId).toHaveBeenCalledWith(1);
  });
});
