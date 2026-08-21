import { AlertTriangle, UserCheck } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { formatDay } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";

interface RosterProgressHeaderProps {
  selectedSchedule: TrainingSchedule;
  reviewedCount: number;
  totalCount: number;
  unreviewedCount: number;
  onMarkRemainingPresent: () => void;
}

/**
 * The coal header: the live "revisados" marker (issue #313, K5 hallazgo
 * #23) — not raw "presentes", since the roster starts on that default — plus
 * the session it belongs to and the one-tap shortcut for the common case.
 */
export default function RosterProgressHeader({
  selectedSchedule,
  reviewedCount,
  totalCount,
  unreviewedCount,
  onMarkRemainingPresent,
}: RosterProgressHeaderProps): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-5 rounded-card bg-coal px-[22px] py-[18px] text-white">
      <span aria-live="polite" className="text-display font-extrabold leading-none tabular-nums">
        {reviewedCount}
        <span className="text-lg text-white/50">/{totalCount}</span>
      </span>
      <span className="flex min-w-[170px] flex-1 flex-col gap-1">
        <b className="text-base font-bold">revisados</b>
        <span className="flex flex-wrap items-center gap-1.5 text-sm text-white/60">
          <span>{formatDay(selectedSchedule.diaSemana)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {selectedSchedule.horaInicio} — {selectedSchedule.horaFin}
          </span>
        </span>
        {unreviewedCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-bold text-ball">
            <AlertTriangle size={ICON.sm} strokeWidth={2.5} aria-hidden="true" />
            {unreviewedCount === 1 ? "1 alumno sin revisar" : `${unreviewedCount} alumnos sin revisar`}
          </span>
        )}
      </span>
      {unreviewedCount > 0 && (
        <button
          type="button"
          onClick={onMarkRemainingPresent}
          className="inline-flex h-ctl items-center gap-2 rounded-ctl border border-white/25 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10"
        >
          <UserCheck size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Marcar restantes presentes
        </button>
      )}
    </div>
  );
}
