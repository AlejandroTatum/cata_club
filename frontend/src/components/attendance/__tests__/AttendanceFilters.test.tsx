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
  scheduleId: null,
  setScheduleId: () => {},
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

describe("AttendanceFilters — horario select grouping (issue A1)", () => {
  it("keeps 'Todos los horarios' first and ungrouped, ahead of any optgroup", () => {
    render(
      <AttendanceFilters
        filters={controller}
        schedules={[buildSchedule({ id: 1, categoriaLabel: "Competitivo" })]}
      />,
    );

    const select = screen.getByLabelText("Filtrar por horario") as HTMLSelectElement;
    const first = select.children[0] as HTMLOptionElement;
    expect(first.tagName).toBe("OPTION");
    expect(first.value).toBe("");
    expect(first.textContent).toBe("Todos los horarios");
  });

  it("groups options into one optgroup per category", () => {
    render(
      <AttendanceFilters
        filters={controller}
        schedules={[
          buildSchedule({ id: 1, categoriaLabel: "Competitivo" }),
          buildSchedule({ id: 2, categoriaLabel: "Recreativo" }),
          buildSchedule({ id: 3, categoriaLabel: "Competitivo" }),
        ]}
      />,
    );

    const select = screen.getByLabelText("Filtrar por horario") as HTMLSelectElement;
    const groups = select.querySelectorAll("optgroup");
    expect(groups).toHaveLength(2);
    expect(Array.from(groups).map((g) => g.label)).toEqual(["Competitivo", "Recreativo"]);
    expect(within(groups[0] as HTMLOptGroupElement).getAllByRole("option")).toHaveLength(2);
  });

  it("orders options inside a group by weekday (Monday→Sunday), then start time", () => {
    render(
      <AttendanceFilters
        filters={controller}
        schedules={[
          buildSchedule({ id: 1, diaSemana: "vie", horaInicio: "17:00", horaFin: "18:00" }),
          buildSchedule({ id: 2, diaSemana: "lun", horaInicio: "16:00", horaFin: "17:00" }),
          buildSchedule({ id: 3, diaSemana: "lun", horaInicio: "15:00", horaFin: "16:00" }),
        ]}
      />,
    );

    const select = screen.getByLabelText("Filtrar por horario") as HTMLSelectElement;
    const group = select.querySelector("optgroup") as HTMLOptGroupElement;
    const labels = Array.from(group.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual([
      "Lunes 15:00 — 16:00",
      "Lunes 16:00 — 17:00",
      "Viernes 17:00 — 18:00",
    ]);
  });

  it("groups a schedule with no categoriaLabel under its own fallback group instead of dropping it", () => {
    render(
      <AttendanceFilters
        filters={controller}
        schedules={[buildSchedule({ id: 1, categoriaLabel: undefined })]}
      />,
    );

    const select = screen.getByLabelText("Filtrar por horario") as HTMLSelectElement;
    expect(within(select).getByRole("option", { name: /lunes/i })).toBeInTheDocument();
    expect(select.querySelectorAll("optgroup")).toHaveLength(1);
  });

  it("keeps the same id semantics when an option is selected", () => {
    const setScheduleId = vi.fn();
    render(
      <AttendanceFilters
        filters={{ ...controller, setScheduleId }}
        schedules={[buildSchedule({ id: 7, categoriaLabel: "Competitivo" })]}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filtrar por horario"), { target: { value: "7" } });

    expect(setScheduleId).toHaveBeenCalledWith(7);
  });
});
