/**
 * TimePicker24 — a 24 h "HH:MM" picker. A native `<input type="time">` renders
 * 12 h or 24 h by browser locale, so the admin cannot tell which format
 * applies; this one shows a single unambiguous format everywhere.
 *
 * The trigger button keeps the caller's `id` so a `<label htmlFor>` keeps
 * working. The popover is two grids: hours and 5-minute steps. Picking a
 * minute closes it; picking the last hour pins the minutes to what the upper
 * bound allows.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";

export interface TimePicker24Props {
  id: string;
  /** Accessible name of the trigger and of the popover, e.g. "Hora de inicio". */
  label: string;
  /** "HH:MM", or "" when nothing is chosen yet. */
  value: string;
  /** Earliest selectable time, "HH:MM". */
  min: string;
  /** Latest selectable time, "HH:MM". */
  max: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  /** Muted text shown while `value` is empty. */
  placeholder?: string;
  className?: string;
}

const MINUTE_STEP = 5;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parse(hhmm: string): { h: number; m: number } {
  const [h, m] = hhmm.split(":");
  return { h: Number(h), m: Number(m) };
}

function range(from: number, to: number, step = 1): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

const CELL =
  "h-8 rounded-md text-sm font-semibold tabular-nums transition-colors " +
  "aria-pressed:bg-ink aria-pressed:text-paper hover:bg-sunken aria-pressed:hover:bg-ink " +
  "text-ink-2";

export default function TimePicker24({
  id,
  label,
  value,
  min,
  max,
  onChange,
  invalid,
  describedBy,
  placeholder = "Elegir hora",
  className,
}: TimePicker24Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const lo = parse(min);
  const hi = parse(max);
  const current = value ? parse(value) : null;
  const hours = range(lo.h, hi.h);
  const activeHour = current?.h ?? null;
  const minutes = range(0, 55, MINUTE_STEP).filter((m) => {
    if (activeHour === hi.h) return m <= hi.m;
    if (activeHour === lo.h) return m >= lo.m;
    return true;
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function pickHour(h: number): void {
    let m = current?.m ?? 0;
    if (h === hi.h && m > hi.m) m = hi.m;
    if (h === lo.h && m < lo.m) m = lo.m;
    onChange(`${pad(h)}:${pad(m)}`);
  }

  function pickMinute(m: number): void {
    onChange(`${pad(activeHour ?? lo.h)}:${pad(m)}`);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {/* The trigger stands in for the field, so it carries the field's error state. */}
      {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "h-ctl w-full rounded-ctl border bg-paper text-base font-semibold tabular-nums outline-none",
          "hover:border-ink-3 focus:border-cata-red",
          invalid ? "border-state-bad" : open ? "border-cata-red" : "border-line-2",
          value ? "text-ink" : "font-normal text-ink-3",
        )}
      >
        {value || placeholder}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-[46px] z-10 w-[300px] max-w-[calc(100vw-3rem)] rounded-xl border border-line bg-paper p-3.5 shadow-elevated"
        >
          <p className="mb-1.5 text-2xs font-bold uppercase text-ink-3">Hora</p>
          <div role="group" aria-label="Hora" className="mb-3 grid grid-cols-6 gap-1">
            {hours.map((h) => (
              <button
                key={h}
                type="button"
                className={CELL}
                aria-pressed={activeHour === h}
                onClick={() => pickHour(h)}
              >
                {pad(h)}
              </button>
            ))}
          </div>
          <p className="mb-1.5 text-2xs font-bold uppercase text-ink-3">Minutos</p>
          <div role="group" aria-label="Minutos" className="grid grid-cols-6 gap-1">
            {minutes.map((m) => (
              <button
                key={m}
                type="button"
                className={CELL}
                aria-pressed={current?.m === m}
                onClick={() => pickMinute(m)}
              >
                {pad(m)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
