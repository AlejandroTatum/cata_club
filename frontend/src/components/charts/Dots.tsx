/**
 * Dots — a short history as a row of dots, oldest first, newest on the right.
 *
 * For "how has this student been coming lately": each dot is one session and
 * its tone is the verdict. Tone alone would not survive colour-blindness, so
 * the shape carries the verdict too: a filled dot is someone who trained, a
 * ring is someone who did not. The whole row is one `role="img"` whose name
 * lists every verdict in words, so nothing is colour-only and nothing is
 * pointer-only.
 */

import type { ReactElement } from "react";
import { cn } from "@/components/ui";
import { TONE_BG, type ChartTone } from "./chart-utils";

export interface DotDatum {
  key: string;
  label: string;
  tone: ChartTone;
  /** A ring instead of a filled dot (did not train). */
  hollow?: boolean;
}

export interface DotsProps {
  data: readonly DotDatum[];
  /** What the row is about, e.g. "Últimas asistencias de Ana Pérez". */
  ariaLabel: string;
  className?: string;
}

const RING_TONE: Record<ChartTone, string> = {
  coal: "border-coal",
  ok: "border-state-ok",
  warn: "border-state-warn",
  bad: "border-state-bad",
  neutral: "border-state-neutral",
  muted: "border-line-2",
};

export default function Dots({ data, ariaLabel, className }: DotsProps): ReactElement {
  return (
    <span
      role="img"
      aria-label={`${ariaLabel}: ${data.map((d) => d.label).join(", ")}`}
      title={data.map((d) => d.label).join(" · ")}
      data-testid="dots"
      className={cn("inline-flex items-center gap-1", className)}
    >
      {data.map((dot) => (
        <span
          key={dot.key}
          aria-hidden="true"
          data-tone={dot.tone}
          data-hollow={dot.hollow ? "true" : undefined}
          className={cn(
            "h-2.5 w-2.5 flex-none rounded-full border-2",
            dot.hollow ? cn("bg-paper", RING_TONE[dot.tone]) : cn(TONE_BG[dot.tone], RING_TONE[dot.tone]),
          )}
        />
      ))}
    </span>
  );
}
