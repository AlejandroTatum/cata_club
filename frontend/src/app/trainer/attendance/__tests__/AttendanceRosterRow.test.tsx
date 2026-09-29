/**
 * Component tests for AttendanceRosterRow — the roster's one fiche.
 *
 * Regression focus (issue #1373, found in preview review at 1920px): when the
 * two authorized-absence states turned the state picker into a 2×3 grid, the
 * row's desktop `sm:h-12` fixed its height at 48px and its `overflow-hidden`
 * clipped everything below the first row of three. Six radios existed in the
 * DOM; three were visible. The row must grow with its content instead — at
 * every breakpoint — while keeping the 44px touch targets and the radiogroup
 * keyboard contract that the page-level tests already exercise.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import AttendanceRosterRow from "@/app/trainer/attendance/AttendanceRosterRow";
import { UNMARKED, type SessionStudent } from "../attendance-utils";

const ALL_STATE_NAMES = ["Presente", "Ausente", "Tardanza", "Justificado", "Enfermo", "Competencia"];

function buildStudent(overrides: Partial<SessionStudent> = {}): SessionStudent {
  return { id: "alumno-1", name: "Ana López", attendance: UNMARKED, ...overrides };
}

interface RenderRowOptions {
  student?: SessionStudent;
}

function renderRow({ student = buildStudent() }: RenderRowOptions = {}) {
  const handlers = {
    onCycleAttendance: vi.fn(),
    onDirectAttendanceSet: vi.fn(),
    onRadioKeyDown: vi.fn(),
  };
  render(
    <ul>
      <AttendanceRosterRow
        student={student}
        studentIndex={0}
        {...handlers}
      />
    </ul>,
  );
  return handlers;
}

describe("AttendanceRosterRow — the row never clips its own radiogroup (#1373)", () => {
  it("grows with its content: the li carries no fixed-height utility at any breakpoint", () => {
    renderRow();

    const row = screen.getByRole("listitem");
    /*
     * The defect pair was `sm:h-12` (fixed 48px row) + `overflow-hidden`
     * (clipper): the second grid row of three states was rendered but not
     * visible. `overflow-hidden` stays as the rounded-corner clip for the
     * hover surface, so the guard bans every height CAP (`h-*`, `max-h-*`,
     * any breakpoint) — a row that must hold two stacked 44px targets cannot
     * have one. That is the exact property whose absence caused the bug;
     * geometry itself is proven by the batched Playwright check (jsdom has
     * no layout).
     */
    expect(row.className).not.toMatch(/(?:^|\s)(?:[\w-]+:)*(?:max-)?h-\d+(?=\s|$)/);
    expect(row.className).not.toContain("sm:h-12");
  });

  it("renders all six states as radios on a 3-column base grid with 44px targets", () => {
    renderRow();

    const group = screen.getByRole("radiogroup", { name: /Ana López/ });
    expect(group.className).toContain("grid-cols-3");

    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(6);
    radios.forEach((radio, i) => {
      expect(radio).toHaveAccessibleName(ALL_STATE_NAMES[i]);
      expect(radio.className).toContain("min-h-[44px]");
      expect(radio.className).toContain("min-w-[44px]");
    });
  });

  it("keeps the radiogroup contract: roving tabindex, click and keydown wired", () => {
    const handlers = renderRow({ student: buildStudent({ attendance: "present", reviewed: true }) });

    const group = screen.getByRole("radiogroup", { name: /Ana López/ });
    expect(within(group).getByRole("radio", { name: "Presente" })).toHaveAttribute("tabindex", "0");
    for (const name of ALL_STATE_NAMES.slice(1)) {
      expect(within(group).getByRole("radio", { name })).toHaveAttribute("tabindex", "-1");
    }

    fireEvent.click(within(group).getByRole("radio", { name: "Enfermo" }));
    expect(handlers.onDirectAttendanceSet).toHaveBeenCalledWith(0, "sick");

    fireEvent.keyDown(within(group).getByRole("radio", { name: "Ausente" }), { key: "ArrowRight" });
    expect(handlers.onRadioKeyDown).toHaveBeenCalledTimes(1);
    expect(handlers.onRadioKeyDown.mock.calls[0][1]).toBe(0);
    expect(handlers.onRadioKeyDown.mock.calls[0][2]).toBe("absent");
  });

  it("wraps 3-wide on narrow devices and puts all six in ONE row from lg up (#1373 feedback)", () => {
    renderRow();

    const group = screen.getByRole("radiogroup", { name: /Ana López/ });
    // Narrow band (below lg): the incumbent 3×2 ergonomics stay — one wrap,
    // no intermediate breakpoint rewrapping the grid again.
    expect(group.className).toContain("grid-cols-3");
    expect(group.className).not.toMatch(/(?:^|\s)(?:sm|md):grid-cols-\d+(?=$|\s)/);
    // Desktop (lg+): six equal columns = a single horizontal row of six.
    expect(group.className).toContain("lg:grid-cols-6");

    /* jsdom has no layout, so "one row" here is the class contract — six
     * `1fr` tracks cannot wrap. The measured geometry (six boxes in one
     * y-band inside the row, no horizontal overflow, first/sixth clickable)
     * is proven by the batched Playwright check against the production
     * build, recorded in odd/tasks/1373-attendance.md. */
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(6);
    radios.forEach((radio) => {
      // Meaningful label survives the one-row desktop layout.
      expect(radio).toHaveAccessibleName(/.+/);
      expect(radio.className).toContain("min-w-[44px]");
      expect(radio.className).toContain("min-h-[44px]");
    });
  });
});
