import { AlertTriangle } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { resolveFailedStudentNames, type SessionStudent } from "./attendance-utils";
import type { RegisterAttendanceResult } from "@/services/api";

interface FailedRecordsNoticeProps {
  failed: RegisterAttendanceResult["failed"];
  students: SessionStudent[];
}

/**
 * NAME the students (issue #213 decision 3) — this used to say "N registro(s)
 * no se pudieron guardar" and ask the trainer to retry for names it refused
 * to identify.
 */
export default function FailedRecordsNotice({
  failed,
  students,
}: FailedRecordsNoticeProps): React.ReactElement {
  return (
    <div role="alert" className="rounded-ctl border border-state-warn/25 bg-state-warn-bg p-3.5 text-xs text-state-warn">
      <p className="flex items-center gap-1.5 font-bold">
        <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        {failed.length === 1
          ? "No se pudo guardar 1 registro"
          : `No se pudieron guardar ${failed.length} registros`}
      </p>
      <ul className="mt-1.5 list-inside list-disc font-semibold">
        {resolveFailedStudentNames(failed, students).map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-state-warn/80">
        Vuelva a tomar lista de este horario para reintentar con estos alumnos — el resto ya
        quedó guardado.
      </p>
    </div>
  );
}
