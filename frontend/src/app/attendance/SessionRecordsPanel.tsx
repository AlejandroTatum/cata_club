/**
 * The drill-down of one session on the admin's `/attendance`: its records, one
 * line per student, each with the "Corregir" door (reason required, 30-day
 * window) that used to live in a flat per-record table.
 */

import { Badge } from "@/components/ui";
import AttendanceCorrectionAction, {
  type AttendanceCorrectionPatch,
} from "./AttendanceCorrectionAction";
import {
  getAttendanceBadgeTone,
  getAttendanceLabel,
  type AttendanceRecord,
} from "./attendance-utils";

interface SessionRecordsPanelProps {
  readonly records: readonly AttendanceRecord[];
  readonly onCorrected: (
    recordId: string,
    patch: AttendanceCorrectionPatch,
  ) => void;
}

export default function SessionRecordsPanel({
  records,
  onCorrected,
}: SessionRecordsPanelProps): React.ReactElement {
  return (
    <ul
      className="flex flex-col divide-y divide-line text-left"
      aria-label="Registros de la sesión"
    >
      {records.map((record) => (
        <li
          key={record.id}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2"
        >
          <span className="min-w-0 flex-1 basis-40 font-semibold text-ink">
            {record.estudiante}
          </span>
          <Badge tone={getAttendanceBadgeTone(record.estado)}>
            {getAttendanceLabel(record.estado)}
          </Badge>
          {record.requiereRevision && (
            // ENT-07: accepted although the student was not operative, or the date
            // is before their enrolment — the admin decides whether it stands.
            <span title="Se registró con el alumno no operativo o antes de su inscripción.">
              <Badge tone="warn">Requiere revisión</Badge>
            </span>
          )}
          <AttendanceCorrectionAction
            record={record}
            onCorrected={onCorrected}
          />
        </li>
      ))}
    </ul>
  );
}
