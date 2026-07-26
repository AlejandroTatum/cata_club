/**
 * Wizard steps as browser history entries.
 *
 * ## The defect this closes
 *
 * The product has four wizards — the trainer's roll call, public enrolment,
 * admin account creation and adding a dependent — and every one of them held
 * its step in a `useState`. So the browser's Back button, the one control every
 * user already knows and the only "undo" a browser guarantees, did not step
 * back: it left the wizard entirely, from any step, with no warning. On the
 * roll call that meant a half-marked list of forty students gone in one tap.
 *
 * The usability evaluation named it directly: "Los tres pasos del wizard no son
 * entradas de historial."
 *
 * ## Why the URL, and why `history.pushState` rather than `router.push`
 *
 * The step belongs in the URL because the URL is where the browser keeps the
 * back stack. Going through `router.push` would fetch the segment's RSC payload
 * on every step, adding a network round trip to a transition that is pure
 * client state. Next.js 14.1+ supports the native History API for exactly this
 * case: `window.history.pushState` updates the URL, feeds `useSearchParams`,
 * and costs nothing.
 *
 * ## Why the step number is clamped, always
 *
 * Putting the step in the URL makes it addressable, and addressable means
 * attackable by accident: a reload, a bookmark, a shared link or a typo can now
 * ask for step 3 of a wizard whose client state is empty. `maxReachableIndex`
 * is the caller's answer to "how far has this session actually got", and every
 * read clamps to it — so `?paso=3` on a fresh load lands on step 1 instead of
 * rendering a confirmation screen with nothing to confirm.
 *
 * The parameter is a 1-based NUMBER rather than a slug because that is exactly
 * what the stepper already says out loud ("Paso 2 de 3"), and because it is the
 * one encoding all four wizards can share without four slug tables.
 */

"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Query parameter carrying the wizard step, in the product's own language. */
export const WIZARD_STEP_PARAM = "paso";

/**
 * The step the URL asks for, clamped to the order and to what the wizard can
 * actually show right now.
 */
export function resolveStepFromParam<S extends string>(
  raw: string | null,
  order: readonly S[],
  maxReachableIndex: number,
): S {
  const asked = Number.parseInt(raw ?? "", 10);
  if (Number.isNaN(asked)) return order[0];
  const ceiling = Math.min(maxReachableIndex, order.length - 1);
  const index = Math.min(Math.max(asked - 1, 0), Math.max(ceiling, 0));
  return order[index];
}

/**
 * How far a form wizard can legitimately be addressed.
 *
 * The roll call has one flag for this — the roster either loaded or it did not.
 * A form wizard does not: the only truth about "how far did they get" is
 * whether each step's fields are filled. So the ceiling is the first step whose
 * predecessor is still incomplete, which is exactly the step the visitor would
 * be standing on if they had walked there themselves. Stopping at the first
 * GAP, rather than at the last completed step, is what keeps a deep link from
 * skipping validation: a filled step 3 unlocks nothing while step 2 is empty.
 */
export function furthestReachableIndex<S extends string>(
  order: readonly S[],
  isComplete: (step: S) => boolean,
): number {
  let index = 0;
  while (index < order.length - 1 && isComplete(order[index])) index += 1;
  return index;
}

/** The value to write for a step — the same number the stepper displays. */
export function stepParamValue<S extends string>(step: S, order: readonly S[]): string {
  return String(Math.max(order.indexOf(step), 0) + 1);
}

export interface WizardHistory<S extends string> {
  /** The step to render — already clamped, never out of range. */
  step: S;
  /** Move forward (or to any step), pushing a history entry. */
  goToStep: (step: S) => void;
  /**
   * Move back. Delegates to the browser so the wizard's own "Atrás" and the
   * browser's Back are literally the same operation rather than two
   * navigations that disagree.
   */
  goBack: () => void;
  /** Return to the first step without leaving a trail — used by "start over". */
  resetToFirstStep: () => void;
}

/**
 * Hold a wizard's step in the URL.
 *
 * Must be rendered inside a `<Suspense>` boundary, like every other
 * `useSearchParams` caller in this codebase (`student/payments`,
 * `reset-password`), because Next.js cannot prerender a component that reads
 * the query string.
 */
export function useWizardHistory<S extends string>(
  order: readonly S[],
  maxReachableIndex: number,
): WizardHistory<S> {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get(WIZARD_STEP_PARAM);
  const step = resolveStepFromParam(raw, order, maxReachableIndex);

  const urlForStep = useCallback(
    (next: S): string => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(WIZARD_STEP_PARAM, stepParamValue(next, order));
      return `${pathname}?${params.toString()}`;
    },
    [order, pathname, searchParams],
  );

  const goToStep = useCallback(
    (next: S): void => {
      if (next === step) return;
      window.history.pushState(null, "", urlForStep(next));
    },
    [step, urlForStep],
  );

  const goBack = useCallback((): void => {
    window.history.back();
  }, []);

  const resetToFirstStep = useCallback((): void => {
    window.history.replaceState(null, "", urlForStep(order[0]));
  }, [order, urlForStep]);

  /**
   * Repair a URL that asks for a step the wizard cannot show.
   *
   * `replaceState`, not `pushState`: the entry being repaired is one the user
   * arrived at, so replacing it means the next Back leaves the wizard instead
   * of bouncing them off the same unreachable step forever.
   */
  useEffect(() => {
    if (raw === null && step === order[0]) return;
    const corrected = stepParamValue(step, order);
    if (raw === corrected) return;
    window.history.replaceState(null, "", urlForStep(step));
  }, [order, raw, step, urlForStep]);

  return { step, goToStep, goBack, resetToFirstStep };
}
