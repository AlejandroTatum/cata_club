/**
 * MoneyInput — a text input with a "$" (or "%") adornment drawn inside the
 * field. The adornment is decoration (`aria-hidden`); the input keeps its own
 * label and every prop, so callers keep their numeric masking untouched.
 */

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

export interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Adornment glyph. Defaults to "$". */
  symbol?: string;
  /** Which edge the adornment sits on. Defaults to the start ("$ 45.00"). */
  symbolPosition?: "start" | "end";
  type?: "text" | "number";
}

const BASE =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper text-sm text-ink tabular-nums outline-none focus:border-cata-red";

const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { symbol = "$", symbolPosition = "start", type = "text", className, ...rest },
  ref,
) {
  const atStart = symbolPosition === "start";
  return (
    <span className="relative block">
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 flex items-center text-sm font-bold text-ink-3",
          atStart ? "left-3" : "right-3",
        )}
      >
        {symbol}
      </span>
      <input
        ref={ref}
        type={type}
        inputMode={type === "text" ? "decimal" : undefined}
        {...rest}
        className={cn(BASE, atStart ? "pl-7 pr-3" : "pl-3 pr-7", className)}
      />
    </span>
  );
});

export default MoneyInput;
