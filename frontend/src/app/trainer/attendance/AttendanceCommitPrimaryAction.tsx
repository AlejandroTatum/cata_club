import { CheckCircle, ChevronRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Button } from "@/components/ui";

const UNMARKED_REASON_ID = "attendance-unmarked-reason";

interface AttendanceCommitPrimaryActionProps {
  isFirst: boolean;
  isLast: boolean;
  submitting: boolean;
  studentsCount: number;
  unmarkedCount: number;
  readOnly: boolean;
  rosterLoading: boolean;
  selectedScheduleId: number | null;
  onContinueToRoster: () => void;
  onNext: () => void;
}

/**
 * The commit bar's one primary action, whichever of the three steps it is —
 * see `AttendanceCommitBar`'s own note on why each branch needs its own
 * `key`: sharing one `Button` node between "button" and "submit" is what let
 * one tap on "Siguiente" advance the wizard AND file the session (React
 * flushes the click's state update before the browser runs its default
 * action, so the node under the finger was already `type="submit"`).
 */
export default function AttendanceCommitPrimaryAction({
  isFirst,
  isLast,
  submitting,
  studentsCount,
  unmarkedCount,
  readOnly,
  rosterLoading,
  selectedScheduleId,
  onContinueToRoster,
  onNext,
}: AttendanceCommitPrimaryActionProps): React.ReactElement {
  const describedBy = unmarkedCount > 0 ? UNMARKED_REASON_ID : undefined;

  if (isFirst) {
    return (
      <Button
        key="open-roster"
        type="button"
        variant="primary"
        onClick={onContinueToRoster}
        disabled={!selectedScheduleId || rosterLoading}
      >
        {rosterLoading ? "Cargando estudiantes…" : "Continuar"}
        <ChevronRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
      </Button>
    );
  }

  if (!isLast) {
    return (
      <Button
        key="advance"
        type="button"
        variant="primary"
        onClick={onNext}
        disabled={studentsCount === 0 || unmarkedCount > 0 || readOnly}
        aria-describedby={describedBy}
      >
        Revisar y confirmar
        <ChevronRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button
      key="file-session"
      type="submit"
      variant="primary"
      disabled={submitting || studentsCount === 0 || unmarkedCount > 0 || readOnly}
      aria-describedby={describedBy}
    >
      {submitting ? (
        "Registrando…"
      ) : (
        <>
          <CheckCircle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Confirmar asistencia
        </>
      )}
    </Button>
  );
}
