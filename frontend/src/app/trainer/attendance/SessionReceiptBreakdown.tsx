import type { EstadoAsistencia } from "@/types/domain";
import StudentReviewList, { StatusTiles } from "./StudentReviewList";
import type { SessionStudent } from "./attendance-utils";

interface SessionReceiptBreakdownProps {
  hasFailedRecords: boolean;
  receiptCounts: Record<EstadoAsistencia, number>;
  receiptTotal: number;
  students: SessionStudent[];
}

/**
 * The desglose: six state tiles (a zero shrinks and mutes, it does not vanish)
 * and every saved student with the state they were filed under. Counts what
 * got SAVED, not what the trainer marked.
 */
export default function SessionReceiptBreakdown({
  hasFailedRecords,
  receiptCounts,
  receiptTotal,
  students,
}: SessionReceiptBreakdownProps): React.ReactElement {
  return (
    <div className="card flex flex-col gap-5 p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-3">
        {hasFailedRecords ? `Cómo quedó la sesión · ${receiptTotal} guardados` : "Cómo quedó la sesión"}
      </p>
      <StatusTiles counts={receiptCounts} />
      <StudentReviewList students={students} />
    </div>
  );
}
