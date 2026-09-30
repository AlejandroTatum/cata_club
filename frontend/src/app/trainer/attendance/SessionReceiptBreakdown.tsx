import { SessionCompositionCounts } from "@/app/trainer/SessionComposition";
import type { EstadoAsistencia } from "@/types/domain";
import SessionDonut from "./SessionDonut";
import SessionStatusGroups from "./SessionStatusGroups";
import type { SessionStudent } from "./attendance-utils";

interface SessionReceiptBreakdownProps {
  hasFailedRecords: boolean;
  receiptCounts: Record<EstadoAsistencia, number>;
  receiptTotal: number;
  students: SessionStudent[];
}

/**
 * The desglose, as a compact receipt: the ring and a legend of only the
 * states somebody is in (a zero is not a row — it collapses into one muted
 * line under the names), then who is in each state. Counts what got SAVED,
 * not what the trainer marked.
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

      <div className="grid gap-6 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
        <div className="flex flex-col items-start gap-4 md:items-center">
          <SessionDonut counts={receiptCounts} total={receiptTotal} className="flex-none" />
          <SessionCompositionCounts
            counts={receiptCounts}
            total={receiptTotal}
            className="flex-col !gap-y-1.5"
            hideZero
          />
        </div>
        <SessionStatusGroups students={students} className="md:border-l md:border-line md:pl-6" />
      </div>
    </div>
  );
}
