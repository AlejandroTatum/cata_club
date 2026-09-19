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
 *
 * #1321 — two additions, both opt-independent of each other:
 *
 *   · Navigable: pass `onStepClick` and every COMPLETED pill becomes a real
 *     `<button>` that fires it with the step's index. The current and every
 *     future step stay plain, non-interactive `<span>`s either way. Omit the
 *     prop and nothing changes — every pill is a `<span>`, exactly as before.
 *
 *   · Compact below `sm:`: the five wrapped pills never fit a phone width, so
 *     below `sm:` they are replaced by "Paso N de M · Label" plus a row of
 *     small dots (done dots reuse `onStepClick` too). This is NOT gated by
 *     the prop — every caller gets the compact phase summary on a phone,
 *     whether or not its stepper is navigable.
 *
 * The two renderings are kept out of each other's way for assistive tech
 * rather than toggled by a JS breakpoint: the desktop `<ol>` carries the full
 * step semantics (names, states, `aria-current`) and is the only `role="list"`
 * in the component; the compact block is plain markup with its own text, and
 * its non-interactive dots are `aria-hidden` — they restate what the "Paso N
 * de M · Label" line already says, so a screen reader is not made to read the
 * same five names twice.
 */

import type { ReactElement } from "react";
import { Check } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { cn } from "./cn";

export interface StepperProps {
  /** Step names, in order. */
  steps: string[];
  /** 1-based index of the step in progress. */
  current: number;
  /** Accessible name for the list, e.g. "Pasos de la inscripción". */
  label: string;
  className?: string;
  /**
   * Called with the 0-based index of a COMPLETED step when its pill (or its
   * compact dot) is clicked. Leaving it unset keeps the stepper exactly as it
   * was before #1321 — no step is ever interactive.
   */
  onStepClick?: (index: number) => void;
  /**
   * Whether the compact "Paso N de M" summary states the total. Defaults to
   * `true`; the enroll wizard sets it `false` on its own step 1, where — per
   * #317/#31 — `steps.length` is not a committed fact yet (choosing
   * "Representante" there still adds a step), the same reason its own header
   * says bare "Paso 1" instead of "Paso 1 de 4".
   */
  showCount?: boolean;
}

const PILL =
  "h-ctl-sm inline-flex items-center gap-[7px] rounded-full border px-[13px] text-xs font-semibold";
const DISC =
  "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-2xs tracking-flat font-extrabold";

/**
 * `position` / `done` / `active` / `clickable` for one step — issue #1332
 * (R2-001): this used to be computed twice, once per render (the wide pills
 * and the compact dots), so a future field added to one loop and not the
 * other would silently diverge them. One derivation, fed to both.
 */
interface StepState {
  position: number;
  done: boolean;
  active: boolean;
  clickable: boolean;
}

function deriveStepState(index: number, current: number, navigable: boolean): StepState {
  const position = index + 1;
  const done = position < current;
  const active = position === current;
  return { position, done, active, clickable: done && navigable };
}

export default function Stepper({
  steps,
  current,
  label,
  className,
  onStepClick,
  showCount = true,
}: StepperProps): ReactElement {
  const currentLabel = steps[current - 1] ?? "";
  const navigable = Boolean(onStepClick);

  return (
    <div className={className}>
      <ol
        aria-label={label}
        // #1321: the wrapped pill row is a `sm:`-and-up affair now — a phone
        // width gets the compact summary below instead of three broken lines.
        className="hidden items-center gap-[7px] sm:flex sm:flex-wrap"
      >
        {steps.map((step, index) => {
          const { position, done, active, clickable } = deriveStepState(index, current, navigable);

          const pillClassName = cn(
            PILL,
            // #874: a completed pill is FILLED with its own tint (the
            // same pair `Badge`'s `ok` tone spends), not `paper` with
            // tinted text — the pill itself has to read as "done" before
            // anyone reads the label inside it.
            done && "border-state-ok/30 bg-state-ok-bg text-state-ok",
            active && "border-coal bg-coal text-white",
            // #874: pending steps sit on `sunken`, not `paper` — a step
            // nobody has reached yet is the one pill that should read as
            // recessed, not as another white surface next to the wash and
            // the card it sits between.
            !done && !active && "border-line bg-sunken text-ink-3-strong",
          );

          const pillContent = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  DISC,
                  done && "bg-state-ok-bg text-state-ok",
                  active && "bg-ball text-coal",
                  !done && !active && "bg-state-neutral-bg text-ink-3-strong",
                )}
              >
                {done ? <Check size={ICON.sm} strokeWidth={3} /> : position}
              </span>
              {step}
            </>
          );

          return (
            <li key={step} className="flex items-center gap-[7px]">
              {clickable ? (
                <button
                  type="button"
                  data-state="done"
                  className={pillClassName}
                  onClick={() => onStepClick?.(index)}
                >
                  {pillContent}
                </button>
              ) : (
                <span
                  aria-current={active ? "step" : undefined}
                  data-state={done ? "done" : active ? "current" : "upcoming"}
                  className={pillClassName}
                >
                  {pillContent}
                </span>
              )}
              {position < steps.length ? (
                <span aria-hidden="true" className="h-px w-3 flex-none bg-line-2" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* #1321 — compact phone rendering: the phase in words, plus a row of
          dots that echoes it visually. `truncate` keeps the line's height
          fixed regardless of the current label's length, so switching steps
          never jumps the layout. */}
      <div data-testid="stepper-compact" className="sm:hidden">
        <p className="truncate text-xs font-semibold text-ink-2">
          {showCount
            ? `Paso ${current} de ${steps.length} · ${currentLabel}`
            : `Paso ${current} · ${currentLabel}`}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          {steps.map((step, index) => {
            const { done, active, clickable } = deriveStepState(index, current, navigable);
            const dotState = done ? "done" : active ? "current" : "upcoming";
            const dotVisualClassName = cn(
              "rounded-full",
              active ? "h-2.5 w-2.5 bg-coal" : "h-2 w-2",
              done && "bg-state-ok",
              !done && !active && "bg-line-2",
            );

            // Interactive dots keep their own accessible name (they are not
            // inside the `<ol>`, so they cannot borrow its step-list
            // semantics). The rest are decorative — the paragraph above
            // already names the current phase in full — so they are
            // `aria-hidden` rather than read out as five more nameless dots.
            //
            // #1332 (R4-001, review advisory de #1331): a clickable dot used
            // to BE the 8px visual mark, so its own hit area was 8px on the
            // one breakpoint where this row only ever meets a thumb. The
            // 8px mark stays exactly as small, now centred inside a 24px
            // square button — the project's `MIN_TARGET_CLASS` floor
            // (`lib/target-size.ts`), spelled as `h-6 w-6` because this
            // control is icon-only, the same carve-out that constant's own
            // doc comment names for `app/student/enroll`'s checkbox.
            return clickable ? (
              <button
                key={step}
                type="button"
                data-state={dotState}
                aria-label={`Volver a ${step}`}
                className="flex h-6 w-6 flex-none items-center justify-center"
                onClick={() => onStepClick?.(index)}
              >
                <span aria-hidden="true" className={dotVisualClassName} />
              </button>
            ) : (
              <span key={step} data-state={dotState} aria-hidden="true" className={dotVisualClassName} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
