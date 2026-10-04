import Link from "next/link";
import { Button, PAGE_RAIL, StatCard, buttonClasses } from "@/components/ui";
import { formatDay } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { formatDateTime } from "@/lib/format-utils";
import type { RegisterAttendanceResult } from "@/services/api";
import type { EstadoAsistencia } from "@/types/domain";
import { formatSessionDateLabel, type SessionStudent } from "./attendance-utils";
import SessionDonut from "./SessionDonut";
import FailedRecordsNotice from "./FailedRecordsNotice";
import SessionReceiptBreakdown from "./SessionReceiptBreakdown";

interface AttendanceReceiptProps {
  selectedSchedule: TrainingSchedule | null;
  confirmationHeadingRef: React.RefObject<HTMLHeadingElement>;
  result: RegisterAttendanceResult | null;
  confirmedAt: Date | null;
  /** The session's day ("YYYY-MM-DD") — the list is filed FOR this date, not for when it was saved. */
  sessionDate: string | null;
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
  sessionDate,
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
  // The names under the ring are who got SAVED — a student whose record
  // failed is named by the notice above, not filed under a state they do not
  // have on the server.
  const failedIds = new Set(result?.failed.map((f) => String(f.personaId)));
  const savedStudents = students.filter((student) => !failedIds.has(student.id));
  // ENT-03: when EVERY failure is "already registered" (another trainer filed
  // first) nobody is missing — saying "Faltan N" / "0/N" would send the trainer
  // to redo a list that is complete.
  const allAlreadyRegistered =
    hasFailedRecords && (result?.failed.every((f) => f.alreadyRegistered) ?? false);
  const needsRetry = hasFailedRecords && !allAlreadyRegistered;
  const registeredBy = result?.failed.find((f) => f.registradoPorNombre)?.registradoPorNombre ?? null;

  return (
    <div className={PAGE_RAIL}>
      <div data-dash-col className="flex flex-col gap-page">
        <div>
          <p className="text-2xs font-bold uppercase tracking-wide text-ink-3">
            {(() => {
              if (allAlreadyRegistered) return "La lista ya estaba guardada";
              return needsRetry ? "Asistencia registrada parcialmente" : "Asistencia registrada";
            })()}
          </p>
          {/* `tabIndex={-1}`: reachable only by the focus effect, never a Tab
            stop of its own. It takes programmatic focus after the step
            change (screen readers announce it), but draws no ring: a box
            around a heading nobody can tab to only reads as a glitch. */}
          <h2
            ref={confirmationHeadingRef}
            tabIndex={-1}
            className="inline-block font-display text-lg uppercase leading-tight tracking-flat text-ink focus:outline-none"
          >
            {selectedSchedule
              ? `${formatDay(selectedSchedule.diaSemana)} ${selectedSchedule.horaInicio} — ${selectedSchedule.horaFin}`
              : "Horario seleccionado"}
          </h2>
          {sessionDate && (
            <p className="mt-0.5 text-sm font-semibold text-ink-2">{formatSessionDateLabel(sessionDate)}</p>
          )}
        </div>

        {/* The identity band: what quedó archivado, sobre cuántos, cuándo y quién. */}
        <StatCard
          variant="hot"
          label={
            allAlreadyRegistered
              ? "Ya estaba guardada en el historial del club"
              : needsRetry
              ? `Falta${result && result.failed.length === 1 ? "" : "n"} ${result?.failed.length ?? 0} ${result?.failed.length === 1 ? "jugador" : "jugadores"} por guardar`
              : "Guardada en el historial del club"
          }
          value={allAlreadyRegistered ? students.length : (result?.createdCount ?? 0)}
          unit={
            allAlreadyRegistered
              ? students.length === 1
                ? "jugador"
                : "jugadores"
              : `/${students.length} ${students.length === 1 ? "jugador" : "jugadores"}`
          }
          hint={
            allAlreadyRegistered
              ? `${registeredBy ? `Registrada por ${registeredBy}. ` : ""}No se cambió nada.`
              : confirmedAt
              ? [formatDateTime(confirmedAt.toISOString()), result?.registradoPorNombre].filter(Boolean).join(" · ")
              : undefined
          }
        />

        {result && result.failed.length > 0 && (
          <FailedRecordsNotice failed={result.failed} students={students} />
        )}

        {!allAlreadyRegistered && (
          <SessionReceiptBreakdown
            hasFailedRecords={needsRetry}
            receiptCounts={receiptCounts}
            receiptTotal={receiptTotal}
            students={savedStudents}
          />
        )}

        {/* Issue #241: the retry's own load failure must land here, next to
          the button that triggered it. */}
        {rosterError && needsRetry && (
          <div className="alert-error" role="alert">
            {rosterError}
          </div>
        )}
      </div>

      <aside
        data-dash-col
        className="flex flex-col gap-page lg:self-stretch"
        aria-label="Siguientes pasos"
      >
        <div className="card flex flex-1 flex-col gap-4 p-5">
          {selectedSchedule && (
            <div className="flex flex-col gap-0.5 border-b border-line pb-4">
              <p className="text-2xs font-bold uppercase tracking-wide text-ink-3">Sesión</p>
              <p className="text-sm font-bold text-ink">
                {formatDay(selectedSchedule.diaSemana)} {selectedSchedule.horaInicio} —{" "}
                {selectedSchedule.horaFin}
              </p>
              {selectedSchedule.categoriaLabel && (
                <p className="text-xs text-ink-3">{selectedSchedule.categoriaLabel}</p>
              )}
            </div>
          )}
          <div className="flex flex-1 items-center justify-center border-b border-line pb-4">
            <SessionDonut counts={receiptCounts} total={receiptTotal} />
          </div>
          <p className="text-xs font-bold uppercase tracking-wide text-ink-3">Qué sigue</p>
          {/* One way back, not two — see the page's own note on why the
            frame's `BackLink` is the one that stays. */}
          <div className="flex flex-col gap-2">
            {needsRetry ? (
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
                  className={`w-full justify-center ${rosterLoading ? "cursor-not-allowed opacity-45" : ""}`}
                >
                  {retryButtonLabel}
                </Button>
                <Button type="button" variant="secondary" onClick={onReset} className="w-full justify-center">
                  Registrar otra asistencia
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="primary" onClick={onReset} className="w-full justify-center">
                  Registrar otra asistencia
                </Button>
                <Link
                  href={attendanceHistoryHref}
                  className={buttonClasses("secondary", "md", "w-full justify-center")}
                >
                  Ver historial de asistencias
                </Link>
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
