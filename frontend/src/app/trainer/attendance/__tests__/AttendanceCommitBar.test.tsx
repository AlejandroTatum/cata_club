import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AttendanceCommitBar from "../AttendanceCommitBar";
import { UNMARKED, type SessionStudent } from "../attendance-utils";

function renderBar(
  step: "select-session" | "mark-attendance" | "confirm",
  students: SessionStudent[] = [],
) {
  render(
    <AttendanceCommitBar
      step={step}
      isFirst={step === "select-session"}
      isLast={step === "confirm"}
      submitting={false}
      onBack={vi.fn()}
      lastUndoable={null}
      onUndo={vi.fn()}
      students={students}
      unreviewedCount={0}
      unmarkedCount={0}
      readOnly={false}
      rosterLoading={false}
      selectedScheduleId={1}
      onContinueToRoster={vi.fn()}
      onNext={vi.fn()}
    />,
  );
  return screen.getByTestId("attendance-commit-bar");
}

describe("AttendanceCommitBar", () => {
  it.each(["select-session", "mark-attendance", "confirm"] as const)(
    "is pinned to the viewport above the tab bar on phones and static from lg (%s)",
    (step) => {
      const bar = renderBar(step);
      expect(bar).toHaveClass("fixed", "inset-x-0", "bottom-[62px]", "lg:static");
      expect(bar).not.toHaveClass("sticky");
    },
  );

  // ENT-14: 44px targets and a bar that does not eat a quarter of the screen.
  it("keeps every action at 44px and hides the zero-count states below lg", () => {
    const bar = renderBar("mark-attendance");
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("min-h-[44px]");
    }
    expect(bar.querySelector(".max-lg\\:hidden")).not.toBeNull();
  });

  // #1787-g: a roster where every player is blocked has nothing to save.
  describe("when every player is blocked for non-payment", () => {
    const blocked = (id: number): SessionStudent => ({
      id: String(id), name: `Jugador ${id}`, attendance: UNMARKED, reviewed: true, blocked: true,
    });

    it.each(["mark-attendance", "confirm"] as const)("says so and disables the primary action (%s)", (step) => {
      renderBar(step, [blocked(1), blocked(2)]);
      expect(screen.getByText(/ningún jugador de esta lista puede registrar asistencia/i)).toBeInTheDocument();
      const primary = screen.getByRole("button", {
        name: step === "confirm" ? "Confirmar asistencia" : "Revisar y confirmar",
      });
      expect(primary).toBeDisabled();
    });

    it("stays quiet when at least one player can be marked", () => {
      renderBar("mark-attendance", [blocked(1), { ...blocked(2), blocked: false, attendance: "present" }]);
      expect(screen.queryByText(/ningún jugador de esta lista/i)).not.toBeInTheDocument();
    });
  });
});
