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

/** The meter never reads as an error: weak is the caution ramp, strong the ok ramp. */
const METER_TEXT_TONE: Record<number, string> = {
  1: "text-state-warn",
  2: "text-state-warn",
  3: "text-state-ok",
  4: "text-state-ok",
};

const METER_SEGMENT_TONE: Record<number, string> = {
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
  const label = password.trim() ? PASSWORD_STRENGTH_LABELS[score] : null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-2xs font-bold uppercase text-ink-3">{PASSWORD_GUIDANCE_HEADING}</p>
      {/*
       * `role="status"` so a screen reader hears a recommendation tick over
       * while typing — the same live-readout contract the reset screen's
       * hard checklist already ships.
       */}
      <ul role="status" aria-label={CHECKLIST_LABEL} className="flex flex-col gap-1.5">
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
       * The bar itself is decoration (aria-hidden); the label next to it is
       * the accessible reading, announced through this second live region.
       */}
      <div role="status" aria-label={METER_LABEL} className="flex items-center gap-2">
        <div aria-hidden="true" className="flex flex-1 gap-1">
          {[1, 2, 3, 4].map((segment) => (
            <span
              key={segment}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                segment <= score ? METER_SEGMENT_TONE[score] : "bg-line",
              )}
            />
          ))}
        </div>
        {label && (
          <span className={cn("flex-none text-xs font-semibold", METER_TEXT_TONE[score])}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
