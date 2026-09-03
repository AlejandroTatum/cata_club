"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { LandingSchedule } from "./schedule-data";
import { landingConfig, toWhatsAppLink } from "./landing-config";

/**
 * The simple card, decided 2026-09-02 over the prototype `horarios-simple.html`
 * (issue #988). One vertical list of categories drives one card that shows
 * the FIRST slot's schedule in large type, six day balls, the WhatsApp CTA
 * and one secondary line per additional slot. Replaces the timeline this
 * component used to draw (`schedule-timeline.ts`, deleted with this issue) —
 * a bar chart said nothing the "Horario / Días" facts above it did not
 * already say.
 */
const CATEGORY_COLORS = [
  "var(--landing-brand-red)", "var(--landing-brand-yellow)", "var(--landing-brand-fuchsia)",
  "var(--landing-ball)", "var(--landing-brand-red-strong)", "var(--landing-brand-fuchsia-strong)",
] as const;
/** The ink each swatch above needs under its ball's letter to stay legible. */
const CATEGORY_INK = ["#fff", "var(--landing-brand-black)", "#fff", "var(--landing-brand-black)", "#fff", "#fff"] as const;

const DAY_BALLS = ["L", "M", "X", "J", "V", "S"] as const;
const DAY_FULL_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

/** The stagger the prototype fixes: 35ms per hour digit, 70ms per day ball. */
const DIGIT_STAGGER_MS = 35;
const BALL_STAGGER_MS = 70;

const HOURS_PATTERN = /(\d{1,2}:\d{2})\D+(\d{1,2}:\d{2})/;

interface ScheduleSelectorProps { schedules: LandingSchedule[] }

/**
 * Reads `(prefers-reduced-motion: reduce)` the same way `LandingMotionLoader`
 * does — `addEventListener`/`removeEventListener`, cleaned up on unmount —
 * except this component only ever reads the value, it never mounts or
 * unmounts anything because of it. The initializer runs during the first
 * render (not after it, like a plain `useEffect` write would), so a visitor
 * who prefers reduced motion never sees the animation classes flash on
 * before this corrects them.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState((): boolean =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect((): (() => void) => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = (): void => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return (): void => media.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/** `"HH:MM – HH:MM"` → its two `"HH:MM"` halves, tolerant of the en dash. */
function splitHours(hours: string): [string, string] {
  const match = HOURS_PATTERN.exec(hours);
  return match ? [match[1], match[2]] : [hours, ""];
}

/** Which of the six day balls (Sunday excluded by design) a days string lights. */
function activeDayIndexes(days: string): boolean[] {
  return DAY_FULL_NAMES.map((name): boolean => days.includes(name));
}

/** One `"HH:MM"` half as a run of per-character spans, staggered when animated. */
function DigitRun({ text, animate }: { text: string; animate: boolean }): React.ReactElement {
  return <>{[...text].map((char, index): React.ReactElement => (
    <span
      key={`${char}-${index}`}
      className="landing-schedule-digit"
      style={animate ? { animationDelay: `${index * DIGIT_STAGGER_MS}ms` } : undefined}
    >
      {char}
    </span>
  ))}</>;
}

export default function ScheduleSelector({ schedules }: ScheduleSelectorProps): React.ReactElement {
  const [selected, setSelected] = useState(0);
  const animate = !useReducedMotion();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  const active = schedules[selected] ?? schedules[0];
  const [main, ...rest] = active.slots;
  const [start, end] = splitHours(main.hours);
  const litDays = activeDayIndexes(main.days);
  const color = CATEGORY_COLORS[selected % CATEGORY_COLORS.length];
  const ink = CATEGORY_INK[selected % CATEGORY_INK.length];
  const waLink = `${toWhatsAppLink(landingConfig.contact.whatsapp[0])}?text=${encodeURIComponent(`Hola, quiero consultar cupo en ${active.category}.`)}`;

  const select = (index: number): void => { setSelected(index); tabRefs.current[index]?.focus(); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const next = event.key === "ArrowDown" ? selected + 1 : event.key === "ArrowUp" ? selected - 1 : -1;
    if (next < 0 || next >= schedules.length) return;
    event.preventDefault(); select(next);
  };

  return <div className="landing-schedule-layout">
    <div className="landing-schedule-list" role="tablist" aria-label="Categorías" aria-orientation="vertical" ref={listRef} onKeyDown={onKeyDown}>
      {schedules.map((schedule, index): React.ReactElement => <button
        key={schedule.category} type="button" role="tab" id={`schedule-tab-${index}`}
        ref={(element): void => { tabRefs.current[index] = element; }}
        aria-selected={index === selected} aria-controls="schedule-panel" tabIndex={index === selected ? 0 : -1}
        className="landing-schedule-tab"
        style={{ "--landing-cat": CATEGORY_COLORS[index % CATEGORY_COLORS.length] } as React.CSSProperties}
        onClick={(): void => select(index)}
      >
        <i className="landing-schedule-dot" aria-hidden="true" />
        <span className="landing-schedule-tab-name">{schedule.category}</span>
        <em className="landing-schedule-tab-hours">{splitHours(schedule.slots[0].hours).join("–")}</em>
      </button>)}
    </div>

    <div
      className="landing-schedule-card" role="tabpanel" id="schedule-panel"
      aria-labelledby={`schedule-tab-${selected}`} aria-live="polite"
      style={{ "--landing-cat": color, "--landing-cat-ink": ink } as React.CSSProperties}
    >
      <h3>{active.category}</h3>
      {active.audience ? <p className="landing-schedule-audience">{active.audience}</p> : null}

      <span className="landing-schedule-label">Horario</span>
      <p className={`landing-schedule-time${animate ? " landing-schedule-time--animate" : ""}`}>
        <DigitRun text={start} animate={animate} />
        <span className="landing-schedule-dash">–</span>
        <DigitRun text={end} animate={animate} />
        <small>{main.days}</small>
      </p>

      <span className="landing-schedule-label">Días</span>
      <div className="landing-schedule-days" aria-label={main.days}>
        {DAY_BALLS.map((label, index): React.ReactElement => {
          const on = litDays[index];
          return <span
            key={label} aria-hidden="true"
            className={`landing-schedule-day${on ? " landing-schedule-day--on" : ""}${on && animate ? " landing-schedule-day--pop" : ""}`}
            style={on && animate ? { animationDelay: `${index * BALL_STAGGER_MS}ms` } : undefined}
          >
            {label}
          </span>;
        })}
      </div>

      <a className="landing-button" href={waLink} target="_blank" rel="noreferrer">
        Consultar cupo por WhatsApp <ArrowRight aria-hidden="true" />
      </a>

      {rest.map((slot, index): React.ReactElement => (
        <p className="landing-schedule-second" key={`${active.category}-${index}`}>
          También <b>{splitHours(slot.hours).join("–")}</b> los {slot.days.toLowerCase()}.
        </p>
      ))}
    </div>
  </div>;
}
