/**
 * The wizard's steps as a vertical list on the coal brand panel — the wide
 * counterpart of the compact `Stepper` that sits above the form on a phone.
 * Same contract: named steps, a completed one is a real button only when the
 * page can jump back to it, the current one carries `aria-current="step"`.
 */

import type { ReactElement } from "react";
import { Check } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { ICON } from "@/lib/icon-size";

interface EnrollStepsProps {
  label: string;
  steps: string[];
  /** 1-based index of the step in progress. */
  current: number;
  onStepClick: (index: number) => void;
}

const DISC =
  "flex h-6 w-6 flex-none items-center justify-center rounded-full text-2xs font-extrabold tracking-flat";

export default function EnrollSteps(props: EnrollStepsProps): ReactElement {
  return (
    <ol aria-label={props.label} className="flex flex-col">
      {props.steps.map((name, index) => {
        const position = index + 1;
        const done = position < props.current;
        const active = position === props.current;
        const state = done ? "done" : active ? "current" : "pending";
        const content = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                DISC,
                done && "bg-state-ok-bg text-state-ok",
                active && "bg-ball text-coal",
                state === "pending" && "bg-white/10 text-white/75",
              )}
            >
              {done ? <Check size={ICON.sm} strokeWidth={3} /> : position}
            </span>
            <span
              data-state={state}
              className={cn(
                "text-sm font-semibold",
                active ? "text-white" : done ? "text-white/90" : "text-white/75",
              )}
            >
              {name}
            </span>
          </>
        );
        return (
          <li
            key={name}
            aria-current={active ? "step" : undefined}
            className="relative flex flex-col"
          >
            {done ? (
              <button
                type="button"
                onClick={() => props.onStepClick(index)}
                className="flex items-center gap-3 rounded-ctl py-1.5 text-left hover:bg-white/10"
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-3 py-1.5">{content}</div>
            )}
            {position < props.steps.length && (
              <span
                aria-hidden="true"
                className={cn("ml-3 h-3 w-px", done ? "bg-state-ok/60" : "bg-white/20")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
