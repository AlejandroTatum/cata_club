import { SessionCompositionBar } from "@/app/trainer/SessionComposition";
import { ATTENDANCE_STATUS_CHART_COLORS } from "@/app/dashboard/dashboard-utils";
import type { EstadoAsistencia } from "@/types/domain";
import { ATTENDANCE_LABELS } from "./attendance-utils";

const TOTAL_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

interface SessionReceiptBreakdownProps {
  hasFailedRecords: boolean;
  receiptCounts: Record<EstadoAsistencia, number>;
  receiptTotal: number;
}

/**
 * The desglose: four states, always all four (issue #213 decision 1 — a zero
 * is atenuado, never omitted), plus a proportional bar for the at-a-glance
 * read. Counts what got SAVED, not what the trainer marked.
 */
export default function SessionReceiptBreakdown({
  hasFailedRecords,
  receiptCounts,
  receiptTotal,
}: SessionReceiptBreakdownProps): React.ReactElement {
  return (
    <div className="card flex flex-col gap-4 p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-3">
        {hasFailedRecords ? `Cómo quedó la sesión · ${receiptTotal} guardados` : "Cómo quedó la sesión"}
      </p>

      <SessionCompositionBar counts={receiptCounts} total={receiptTotal} className="w-full" />

      <ul className="flex flex-col">
        {TOTAL_ORDER.map((state) => {
          const count = receiptCounts[state];
          const isZero = count === 0;
          const percent = receiptTotal > 0 ? Math.round((count / receiptTotal) * 100) : 0;
          return (
            <li
              key={state}
              className="grid grid-cols-[10px_1fr_auto_auto] items-center gap-x-3 border-t border-line py-2.5 first:border-t-0"
            >
              {/* The dot repeats the bar's own colour, so no row is
                  distinguishable by colour alone (issue #213 a11y). */}
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-[3px] ${isZero ? "bg-line-2" : ""}`}
                style={isZero ? undefined : { backgroundColor: ATTENDANCE_STATUS_CHART_COLORS[state] }}
              />
              <span className={`text-sm ${isZero ? "font-normal text-ink-3" : "font-semibold text-ink"}`}>
                {ATTENDANCE_LABELS[state]}
              </span>
              <span
                className={`min-w-[3ch] text-right text-lg font-extrabold tabular-nums tracking-tight ${isZero ? "text-ink-3" : "text-ink"}`}
              >
                {count}
              </span>
              <span className="min-w-[5ch] text-right text-xs tabular-nums text-ink-3">
                {isZero ? "—" : `${percent} %`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
