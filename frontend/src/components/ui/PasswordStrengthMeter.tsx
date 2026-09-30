/**
 * PasswordStrengthMeter — a three-segment bar and ONE line of text that
 * reads a password while it is typed.
 *
 * Presentation only: the thresholds are the ones `PasswordGuidance` and
 * `passwordRule` already use (the 8-character floor, the common-password
 * list, `scorePasswordStrength` for "strong"). Nothing here gates a submit.
 *
 * The visible line carries the `id` the field points its `aria-describedby`
 * at and is NOT a live region — it would be read on every keystroke. A
 * separate hidden status announces only the level, so it changes just when
 * the password crosses from one level to another.
 */

import type { ReactElement } from "react";
import { Check } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import {
  PASSWORD_MIN_LENGTH,
  isCommonPassword,
  scorePasswordStrength,
} from "@/lib/identity-validation";
import { cn } from "./cn";

export type PasswordMeterLevel = "empty" | "short" | "fair" | "strong";

/** Score at or above which the advisory strength reading is "Fuerte". */
const STRONG_SCORE = 3;

/** Same normalization as `passwordRule`: the trimmed value is what counts. */
export function getPasswordMeterLevel(password: string): PasswordMeterLevel {
  const candidate = password.trim();
  if (!candidate) return "empty";
  // A common password is rejected on submit, so it never reads as "valid".
  if (candidate.length < PASSWORD_MIN_LENGTH || isCommonPassword(candidate))
    return "short";
  return scorePasswordStrength(candidate) >= STRONG_SCORE ? "strong" : "fair";
}

const SEGMENTS: Record<PasswordMeterLevel, { filled: number; tone: string }> = {
  empty: { filled: 0, tone: "" },
  short: { filled: 1, tone: "bg-state-bad" },
  fair: { filled: 2, tone: "bg-state-warn" },
  strong: { filled: 3, tone: "bg-state-ok" },
};

const ANNOUNCEMENT: Record<PasswordMeterLevel, string> = {
  empty: "",
  short: "Nivel de la contraseña: corta.",
  fair: "Nivel de la contraseña: válida.",
  strong: "Nivel de la contraseña: segura.",
};

function describe(password: string, level: PasswordMeterLevel): string {
  const candidate = password.trim();
  switch (level) {
    case "empty":
      return `Al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
    case "short": {
      if (candidate.length >= PASSWORD_MIN_LENGTH) {
        return "Es una de las contraseñas más usadas; elija otra.";
      }
      const missing = PASSWORD_MIN_LENGTH - candidate.length;
      return `${candidate.length} de ${PASSWORD_MIN_LENGTH} caracteres — ${
        missing === 1 ? "falta 1" : `faltan ${missing}`
      }.`;
    }
    case "fair":
      return "Válida. Para que sea segura, alárguela o mezcle mayúsculas, números y símbolos.";
    case "strong":
      return "Contraseña segura.";
  }
}

export interface PasswordStrengthMeterProps {
  /** The live password value — fully controlled. */
  value: string;
  /** Id of the text line; the password field's `aria-describedby` points here. */
  id: string;
  className?: string;
}

export default function PasswordStrengthMeter({
  value,
  id,
  className,
}: PasswordStrengthMeterProps): ReactElement {
  const level = getPasswordMeterLevel(value);
  const { filled, tone } = SEGMENTS[level];

  return (
    <div className={cn("mt-field flex flex-col gap-1.5", className)}>
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3].map((segment) => {
          const on = segment <= filled;
          return (
            <span
              key={segment}
              data-segment={on ? "filled" : "empty"}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                on ? tone : "bg-sunken",
              )}
            />
          );
        })}
      </div>
      <p
        id={id}
        className={cn(
          "flex items-center gap-1 text-xs",
          level === "strong" ? "font-semibold text-state-ok" : "text-ink-3",
        )}
      >
        {level === "strong" && (
          <Check size={ICON.sm} strokeWidth={3} aria-hidden="true" />
        )}
        {describe(value, level)}
      </p>
      <span className="sr-only" role="status" aria-live="polite">
        {ANNOUNCEMENT[level]}
      </span>
    </div>
  );
}
