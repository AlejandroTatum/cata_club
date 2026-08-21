import { ChevronLeft, Undo2 } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Button } from "@/components/ui";
import type { SessionStudent, WizardStep } from "./attendance-utils";
import AttendanceTotalsSummary from "./AttendanceTotalsSummary";
import AttendanceCommitPrimaryAction from "./AttendanceCommitPrimaryAction";

const UNMARKED_REASON_ID = "attendance-unmarked-reason";

interface UndoableAction {
  label: string;
}

interface AttendanceCommitBarProps {
  step: WizardStep;
  isFirst: boolean;
  isLast: boolean;
  submitting: boolean;
  onBack: () => void;
  lastUndoable: UndoableAction | null;
  onUndo: () => void;
  students: SessionStudent[];
  unreviewedCount: number;
  unmarkedCount: number;
  readOnly: boolean;
  rosterLoading: boolean;
  selectedScheduleId: number | null;
  onContinueToRoster: () => void;
  onNext: () => void;
}

/**
 * The commit bar. `sticky bottom-0` so the trainer never scrolls the whole
 * card to reach the primary action — all three steps commit from here, one
 * bar, one position, one size, from the first question to the last.
 */
export default function AttendanceCommitBar({
  step,
  isFirst,
  isLast,
  submitting,
  onBack,
  lastUndoable,
  onUndo,
  students,
  unreviewedCount,
  unmarkedCount,
  readOnly,
  rosterLoading,
  selectedScheduleId,
  onContinueToRoster,
  onNext,
}: AttendanceCommitBarProps): React.ReactElement {
  return (
    <div
      data-testid="attendance-commit-bar"
      className="sticky bottom-0 -mx-5 mt-5 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-5 py-3.5 backdrop-blur sm:-mx-6 sm:px-6"
    >
      {!isFirst && (
        <Button type="button" variant="tertiary" onClick={onBack} disabled={submitting}>
          <ChevronLeft size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Atrás
        </Button>
      )}

      {/* Undo lives here, beside the step navigation, because this bar is
          `sticky bottom-0`: on a forty-row roster it is the only control
          always within reach of the row just mistyped. */}
      {step === "mark-attendance" && (
        <Button
          type="button"
          variant="tertiary"
          onClick={onUndo}
          disabled={lastUndoable === null || submitting}
          aria-label={lastUndoable ? `Deshacer: ${lastUndoable.label}` : "Deshacer — no hay nada que deshacer"}
        >
          <Undo2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Deshacer
        </Button>
      )}

      {step === "mark-attendance" && (
        <AttendanceTotalsSummary students={students} unreviewedCount={unreviewedCount} />
      )}

      <div className="ml-auto flex flex-col items-end gap-1.5">
        {/* The `UNMARKED` invariant, and its explanation — no path the wizard
            can take produces the sentinel any more, but a button disabled by
            an invariant still has to say why. */}
        {unmarkedCount > 0 && (
          <p id={UNMARKED_REASON_ID} role="status" className="text-xs font-semibold text-ink-2">
            {unmarkedCount === 1 ? "Falta 1 alumno por marcar" : `Faltan ${unmarkedCount} alumnos por marcar`}
          </p>
        )}
        {/*
         * The `key`s are load-bearing, not decoration — see the page's own
         * note: distinct keys make React replace the node across branches
         * instead of mutating a `type="button"` into `type="submit"` under
         * the same click.
         */}
        <AttendanceCommitPrimaryAction
          isFirst={isFirst}
          isLast={isLast}
          submitting={submitting}
          studentsCount={students.length}
          unmarkedCount={unmarkedCount}
          readOnly={readOnly}
          rosterLoading={rosterLoading}
          selectedScheduleId={selectedScheduleId}
          onContinueToRoster={onContinueToRoster}
          onNext={onNext}
        />
      </div>
    </div>
  );
}
