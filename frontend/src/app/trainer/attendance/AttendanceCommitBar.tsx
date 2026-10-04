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
 * The commit bar. Fixed above the mobile tab bar (below `lg`) so the trainer never scrolls the whole
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
      // Below `lg` the bar is `fixed` above the 62px tab bar: `sticky` cannot
      // work here because its parent is the short aside card, so there is no
      // scroll range to stick within. A forty-row roster never costs a scroll. From `lg` it is the tail of the aside
      // card (no chrome of its own) — stacked, so the actions sit under the summary they commit.
      className="fixed inset-x-0 bottom-[62px] z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-paper/95 px-4 py-2 shadow-soft backdrop-blur lg:static lg:rounded-none lg:border-t-0 lg:flex-col lg:items-stretch lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none"
    >
      {!isFirst && (
        <Button
          type="button"
          variant="tertiary"
          onClick={onBack}
          disabled={submitting}
          className="min-h-[44px] lg:order-3 lg:justify-center"
        >
          <ChevronLeft size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Atrás
        </Button>
      )}

      {/* Undo lives here, beside the step navigation, because this bar is
          pinned to the viewport on mobile: on a forty-row roster it is the only control
          always within reach of the row just mistyped. */}
      {step === "mark-attendance" && (
        <Button
          type="button"
          variant="tertiary"
          onClick={onUndo}
          disabled={lastUndoable === null || submitting}
          className="min-h-[44px] lg:order-3 lg:justify-center"
          aria-label={
            lastUndoable ? `Deshacer: ${lastUndoable.label}` : "Deshacer — no hay nada que deshacer"
          }
        >
          <Undo2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Deshacer
        </Button>
      )}

      {/* The first step has nothing to summarise yet, so the bar's left side
          says what the button will do instead of standing empty. */}
      {step === "select-session" && (
        <p className="min-w-[200px] flex-1 text-xs text-ink-3 lg:order-1 lg:min-w-0 lg:text-sm">
          {selectedScheduleId === null
            ? "Elige un horario de la lista para ver a sus jugadores y marcar la asistencia de cada uno."
            : "Horario elegido: sigue para ver a sus jugadores y marcar la asistencia de cada uno."}
        </p>
      )}

      {step === "mark-attendance" && (
        <AttendanceTotalsSummary students={students} unreviewedCount={unreviewedCount} />
      )}

      <div className="ml-auto flex flex-col items-end gap-1.5 lg:order-2 lg:ml-0 lg:items-stretch lg:[&>button]:w-full lg:[&>button]:justify-center">
        {/* The `UNMARKED` invariant, and its explanation — no path the wizard
            can take produces the sentinel any more, but a button disabled by
            an invariant still has to say why. */}
        {unmarkedCount > 0 && (
          <p id={UNMARKED_REASON_ID} role="status" className="text-xs font-semibold text-ink-2">
            {unmarkedCount === 1 ? "Falta 1 jugador por marcar" : `Faltan ${unmarkedCount} jugadores por marcar`}
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
