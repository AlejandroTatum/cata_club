/**
 * PasswordGuidance — the advisory half of password entry (issue #1395).
 *
 * `passwordRule` and the reset screen's live checklist carry the HARD
 * policy: the 8-character floor and the common-password list (#230, #1017).
 * What was missing on every credential-creation surface is the layer
 * BETWEEN "accepted" and "worth choosing": composition recommendations and
 * a strength reading that move while the person types, so a password that
 * merely clears the floor does not pass in silence.
 *
 * The contract #1395 fixes: everything here INFORMS. No signal in this
 * component gates any submit — `passwordRule` (or the reset screen's
 * equivalent checklist) stays the only enforceable policy, and a
 * policy-compliant password submits with the meter reading "Débil". A
 * recommendation that quietly became a requirement would reject passwords
 * the server accepts, which is exactly the drift #230 closed.
 *
 * The checklist row styling deliberately mirrors the reset screen's hard
 * checklist (same ticks, same `data-met`, same ink ramp): two lists that
 * look different would imply a difference in kind that does not exist —
 * both are readouts, one binding, one advisory; only the heading says
 * which is which.
 *
 * Preview feedback on the first cut (#1395): the segmented strength bar
 * and the row spacing read as loud. The bar is gone — the strength verdict
 * is now one quiet line (a small colored dot plus "Fortaleza: …") and the
 * checklist rhythm is tight. Same information, same live regions, none of
 * the visual weight.
 */

import type { ReactElement } from "react";
import { Check, X } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import {
  PASSWORD_STRENGTH_LABELS,
  buildPasswordCompositionSignals,
  scorePasswordStrength,
} from "@/lib/identity-validation";
import { cn } from "./cn";

/** The one heading the advisory list wears — the word that separates it from the enforcing checklist. */
export const PASSWORD_GUIDANCE_HEADING = "Para una contraseña más fuerte";

const CHECKLIST_LABEL = "Recomendaciones para la contraseña";
const METER_LABEL = "Fortaleza de la contraseña";

/**
 * The verdict never reads as an error: weak is the caution ramp, strong the
 * ok ramp — score 0 included (a short non-empty password reads "Muy débil",
 * and it deserves the same caution tint, not an untinted one).
 */
const VERDICT_TEXT_TONE: Record<number, string> = {
  0: "text-state-warn",
  1: "text-state-warn",
  2: "text-state-warn",
  3: "text-state-ok",
  4: "text-state-ok",
};

const VERDICT_DOT_TONE: Record<number, string> = {
  0: "bg-state-warn",
  1: "bg-state-warn",
  2: "bg-state-warn",
  3: "bg-state-ok",
  4: "bg-state-ok",
};

export interface PasswordGuidanceProps {
  /** The live password value — fully controlled; the component holds no state of its own. */
  password: string;
  className?: string;
}

export default function PasswordGuidance({
  password,
  className,
}: PasswordGuidanceProps): ReactElement {
  const signals = buildPasswordCompositionSignals(password);
  const score = scorePasswordStrength(password);
  // An empty field reads no verdict at all — "Muy débil" before anything is
  // typed would be a verdict about nothing.
  const verdict = password.trim() ? PASSWORD_STRENGTH_LABELS[score] : null;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p className="text-2xs font-bold uppercase text-ink-3">{PASSWORD_GUIDANCE_HEADING}</p>
      {/*
       * `role="status"` so a screen reader hears a recommendation tick over
       * while typing — the same live-readout contract the reset screen's
       * hard checklist already ships.
       */}
      <ul role="status" aria-label={CHECKLIST_LABEL} className="flex flex-col gap-1">
        {signals.map((signal) => (
          <li
            key={signal.label}
            data-met={signal.met}
            className={`flex items-center gap-[7px] text-xs ${
              signal.met ? "font-semibold text-state-ok" : "text-ink-3"
            }`}
          >
            {signal.met ? (
              <Check size={ICON.sm} strokeWidth={3} aria-hidden="true" />
            ) : (
              <X size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            )}
            {signal.label}
          </li>
        ))}
      </ul>
      {/*
       * One quiet verdict line in place of the old bar: the dot is
       * decoration (aria-hidden, color mirrors the text tint); the words are
       * the accessible reading, announced through this second live region.
       * The region stays mounted even while the field is empty — the
       * readout exists, the verdict awaits content.
       */}
      <div role="status" aria-label={METER_LABEL} className="flex items-center gap-1.5">
        {verdict && (
          <>
            <span
              aria-hidden="true"
              className={cn("h-1.5 w-1.5 flex-none rounded-full", VERDICT_DOT_TONE[score])}
            />
            <span className={cn("text-xs font-semibold", VERDICT_TEXT_TONE[score])}>
              Fortaleza: {verdict}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
