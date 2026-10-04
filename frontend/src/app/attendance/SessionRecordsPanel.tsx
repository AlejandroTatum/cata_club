/**
 * The drill-down of one session on the admin's `/attendance`: its records, one
 * line per student, each with the "Corregir" door (reason required, 30-day
 * window) that used to live in a flat per-record table.
 */

import { useState } from "react";
import { Badge, Pagination } from "@/components/ui";
import AttendanceCorrectionAction, {
  type AttendanceCorrectionPatch,
} from "./AttendanceCorrectionAction";
import {
  ATTENDANCE_PAGE_SIZE,
  getAttendanceBadgeTone,
  getAttendanceLabel,
  getTotalPages,
  paginateRecords,
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
  // Local state on purpose: the panel is remounted per opened session, so the
  // page resets to 1 there, while a correction only updates `records` and keeps it.
  const [page, setPage] = useState(1);
  const totalPages = getTotalPages(records.length);
  const currentPage = Math.min(page, totalPages);
  const visible = paginateRecords([...records], currentPage);

  return (
    <>
      <ul
        className="flex flex-col divide-y divide-line text-left"
        aria-label="Registros de la sesión"
      >
        {visible.map((record) => (
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
            <AttendanceCorrectionAction
              record={record}
              onCorrected={onCorrected}
            />
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <Pagination
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={records.length}
          pageSize={ATTENDANCE_PAGE_SIZE}
          itemNoun="registro"
          className="mt-2"
        />
      )}
    </>
  );
}
