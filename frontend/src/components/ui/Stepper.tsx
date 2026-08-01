/**
 * Stepper — named wizard steps.
 *
 * `_sistema.css` `.stp` (:313-320): 32px tall (`--h-ctl-sm`), fully rounded,
 * 13px horizontal padding, 12.5px/600 label, `--line-2` border on `--paper`
 * with an 18px numbered disc. `.stp.on` is coal with a `--ball` disc;
 * `.stp.dn` is `--ok` text on a `rgba(21,127,61,.3)` border with an `--ok-bg`
 * disc, and `20-tomar-lista.html:62` shows the disc carrying a 10px check.
 * `.stpline` is the 12px hairline between pills.
 *
 * Steps are NAMED, never bare numbers — "Horario · Lunes 15:00" tells you what
 * you already decided, "2 de 5" does not.
 */

import type { ReactElement } from "react";
import { Check } from "lucide-react";
import { cn } from "./cn";

export interface StepperProps {
  /** Step names, in order. */
  steps: string[];
  /** 1-based index of the step in progress. */
  current: number;
  /** Accessible name for the list, e.g. "Pasos de la inscripción". */
  label: string;
  className?: string;
}

const PILL =
  "h-ctl-sm inline-flex items-center gap-[7px] rounded-full border px-[13px] text-xs font-semibold";
const DISC =
  "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[10px] font-extrabold";

export default function Stepper({
  steps,
  current,
  label,
  className,
}: StepperProps): ReactElement {
  return (
    <ol
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-[7px]", className)}
    >
      {steps.map((step, index) => {
        const position = index + 1;
        const done = position < current;
        const active = position === current;

        return (
          <li key={step} className="flex items-center gap-[7px]">
            <span
              aria-current={active ? "step" : undefined}
              data-state={done ? "done" : active ? "current" : "upcoming"}
              className={cn(
                PILL,
                done && "border-state-ok/30 bg-paper text-state-ok",
                active && "border-coal bg-coal text-white",
                !done && !active && "border-line-2 bg-paper text-ink-3",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  DISC,
                  done && "bg-state-ok-bg text-state-ok",
                  active && "bg-ball text-coal",
                  !done && !active && "bg-state-neutral-bg text-ink-3",
                )}
              >
                {done ? <Check size={10} strokeWidth={3} /> : position}
              </span>
              {step}
            </span>
            {position < steps.length ? (
              <span aria-hidden="true" className="h-px w-3 flex-none bg-line-2" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
