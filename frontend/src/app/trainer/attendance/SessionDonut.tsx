import { ATTENDANCE_STATUS_CHART_COLORS, buildDonutArcs } from "@/app/dashboard/dashboard-utils";
import { buildSessionBarAriaLabel } from "@/app/trainer/trainer-day-utils";
import type { EstadoAsistencia } from "@/types/domain";
import { attendedCount } from "@/lib/attendance-rule";
import { STATE_DISPLAY_ORDER } from "./StudentReviewList";

const SIZE = 120;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface SessionDonutProps {
  counts: Record<EstadoAsistencia, number>;
  total: number;
  /** What the centre says — defaults to the number of students attending. */
  centerValue?: number;
  centerLabel?: string;
  className?: string;
}

/**
 * The session's composition as a ring, with the attending share in the
 * centre. Same colours and arc maths as the dashboard donut — one vocabulary
 * for one number. The ring carries a text alternative with every count.
 */
export default function SessionDonut({
  counts,
  total,
  centerValue,
  centerLabel = "asisten",
  className = "",
}: SessionDonutProps): React.ReactElement {
  const arcs = buildDonutArcs(
    STATE_DISPLAY_ORDER.map((state) => counts[state]),
    CIRCUMFERENCE,
  );
  const attending = centerValue ?? attendedCount(counts);

  return (
    <div className={`relative inline-flex ${className}`} style={{ width: SIZE, height: SIZE }}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={buildSessionBarAriaLabel(counts, total)}
        className="-rotate-90"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-line"
        />
        {STATE_DISPLAY_ORDER.map((state, index) => (
          <circle
            key={state}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            stroke={ATTENDANCE_STATUS_CHART_COLORS[state]}
            strokeDasharray={arcs[index].dashArray}
            strokeDashoffset={arcs[index].dashOffset}
          />
        ))}
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center leading-none"
      >
        <span className="text-2xl font-extrabold tabular-nums text-ink">
          {attending}
          <span className="text-sm font-bold text-ink-3">/{total}</span>
        </span>
        <span className="mt-1 text-2xs font-bold uppercase tracking-wide text-ink-3">{centerLabel}</span>
      </span>
    </div>
  );
}
