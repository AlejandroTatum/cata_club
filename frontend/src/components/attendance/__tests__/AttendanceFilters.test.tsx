/**
 * A shared panel that forgets its own styling when a caller adjusts one detail
 * is a silent trap: nothing errors, the panel just comes out misaligned.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AttendanceFilters, {
  type AttendanceFiltersController,
} from "@/components/attendance/AttendanceFilters";

// The panel is what is under test; the student typeahead pulls in the API layer
// and answers a different question.
vi.mock("@/components/StudentSearch", () => ({
  default: (): React.ReactElement => <input aria-label="Buscar alumno" />,
}));

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
  studentResetSignal: 0,
  query: null,
};

function renderPanel(className?: string): HTMLElement {
  render(<AttendanceFilters filters={controller} schedules={[]} className={className} />);
  return screen.getByRole("region", { name: "Filtros de registros" });
}

afterEach(cleanup);

/** The classes that make the panel read as a panel, whatever the caller says. */
const BASE_CLASSES = [
  "flex",
  "flex-col",
  "gap-4",
  "rounded-card",
  "border",
  "border-line",
  "bg-paper",
  "p-[18px]",
];

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
