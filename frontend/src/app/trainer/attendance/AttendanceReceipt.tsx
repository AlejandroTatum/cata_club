import Link from "next/link";
import { Button, StatCard, buttonClasses } from "@/components/ui";
import { formatDay } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { formatDateTime } from "@/lib/format-utils";
import type { RegisterAttendanceResult } from "@/services/api";
import type { EstadoAsistencia } from "@/types/domain";
import type { SessionStudent } from "./attendance-utils";
import FailedRecordsNotice from "./FailedRecordsNotice";
import SessionReceiptBreakdown from "./SessionReceiptBreakdown";

interface AttendanceReceiptProps {
  selectedSchedule: TrainingSchedule | null;
  confirmationHeadingRef: React.RefObject<HTMLHeadingElement>;
  result: RegisterAttendanceResult | null;
  confirmedAt: Date | null;
  students: SessionStudent[];
  receiptCounts: Record<EstadoAsistencia, number>;
  receiptTotal: number;
  hasFailedRecords: boolean;
  rosterLoading: boolean;
  retryButtonLabel: string;
  onRetryFailed: () => void;
  onReset: () => void;
  attendanceHistoryHref: string;
  rosterError: string | null;
}

/**
 * The confirmation receipt (issue #213): a record of what got archived, in
 * the page's own left-aligned frame — not a centered announcement of a fact
 * the trainer already knows from having just tapped the button.
 */
export default function AttendanceReceipt({
  selectedSchedule,
  confirmationHeadingRef,
  result,
  confirmedAt,
  students,
  receiptCounts,
  receiptTotal,
  hasFailedRecords,
  rosterLoading,
  retryButtonLabel,
  onRetryFailed,
  onReset,
  attendanceHistoryHref,
  rosterError,
}: AttendanceReceiptProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-2xs font-bold uppercase tracking-wide text-ink-3">
          {hasFailedRecords ? "Asistencia registrada parcialmente" : "Asistencia registrada"}
        </p>
        {/* `tabIndex={-1}`: reachable only by the focus effect, never a Tab
            stop of its own — the system focus ring excludes
            `[tabindex="-1"]`, so it is redrawn by hand here. */}
        <h2
          ref={confirmationHeadingRef}
          tabIndex={-1}
          className="font-display text-lg uppercase leading-tight tracking-flat text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ball focus-visible:shadow-focus-band"
        >
          {selectedSchedule
            ? `${formatDay(selectedSchedule.diaSemana)} ${selectedSchedule.horaInicio} — ${selectedSchedule.horaFin}`
            : "Horario seleccionado"}
        </h2>
      </div>

      {/* The identity band: what quedó archivado, sobre cuántos, cuándo y quién. */}
      <StatCard
        variant="hot"
        label={
          hasFailedRecords
            ? `Falta${result && result.failed.length === 1 ? "" : "n"} ${result?.failed.length ?? 0} ${result?.failed.length === 1 ? "alumno" : "alumnos"} por guardar`
            : "Guardada en el historial del club"
        }
        value={result?.createdCount ?? 0}
        unit={`/${students.length} ${students.length === 1 ? "alumno" : "alumnos"}`}
        hint={
          confirmedAt
            ? `${formatDateTime(confirmedAt.toISOString())} · ${result?.registradoPorNombre ?? "No registrado"}`
            : undefined
        }
      />

      {result && result.failed.length > 0 && (
        <FailedRecordsNotice failed={result.failed} students={students} />
      )}

      <SessionReceiptBreakdown
        hasFailedRecords={hasFailedRecords}
        receiptCounts={receiptCounts}
        receiptTotal={receiptTotal}
      />

      {/* Issue #241: the retry's own load failure must land here, next to
          the button that triggered it. */}
      {rosterError && hasFailedRecords && (
        <div className="alert-error" role="alert">
          {rosterError}
        </div>
      )}

      {/* One way back, not two — see the page's own note on why the
          frame's `BackLink` is the one that stays. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {hasFailedRecords ? (
          <>
            {/* Decision 2: the primary action displaces to the retry — it is
                the only action that actually corrects the state. */}
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                if (!rosterLoading) onRetryFailed();
              }}
              aria-disabled={rosterLoading}
              aria-busy={rosterLoading}
              className={`w-full justify-center sm:w-auto ${rosterLoading ? "cursor-not-allowed opacity-45" : ""}`}
            >
              {retryButtonLabel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={onReset}
              className="w-full justify-center sm:w-auto"
            >
              Registrar otra asistencia
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="primary"
              onClick={onReset}
              className="w-full justify-center sm:w-auto"
            >
              Registrar otra asistencia
            </Button>
            <Link
              href={attendanceHistoryHref}
              className={buttonClasses("secondary", "md", "w-full justify-center sm:w-auto")}
            >
              Ver historial de asistencias
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
