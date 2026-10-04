import { ArrowRight } from "lucide-react";
import type { LandingSchedule } from "./schedule-data";
import { ageScale, compactDays, resolveAgeSpans, type AgeScale, type AgeSpan } from "./schedule-ages";
import { landingConfig, toWhatsAppLink } from "./landing-config";
import ScheduleReveal from "./ScheduleReveal";

/**
 * Proposal C of the Horarios prototypes ("Todo lado a lado", decided
 * 2026-10-02): every category is a card on screen at once, led by the age of
 * the players it is for, so a parent compares instead of clicking through a
 * list. The age bar under each headline marks the ages the category covers on
 * one shared scale, which is what makes the overlaps (5-10 and 8-12) visible.
 * It replaces the tab list and single card of issue #988.
 */

/** Card ground per position, with the ink that stays legible on it and the CTA colours that stand out from it. */
const CARD_PALETTE = [
  { ground: "var(--landing-brand-yellow)", ink: "var(--landing-brand-black)", ctaGround: "var(--landing-brand-black)", ctaInk: "var(--landing-surface)" },
  { ground: "var(--landing-brand-fuchsia-strong)", ink: "var(--landing-surface)", ctaGround: "var(--landing-surface)", ctaInk: "var(--landing-brand-fuchsia-strong)" },
  { ground: "var(--landing-brand-red)", ink: "var(--landing-surface)", ctaGround: "var(--landing-surface)", ctaInk: "var(--landing-brand-red-strong)" },
  { ground: "var(--landing-ball)", ink: "var(--landing-brand-black)", ctaGround: "var(--landing-brand-black)", ctaInk: "var(--landing-surface)" },
  { ground: "var(--landing-brand-black)", ink: "var(--landing-surface)", ctaGround: "var(--landing-surface)", ctaInk: "var(--landing-brand-black)" },
] as const;

interface ScheduleSelectorProps {
  schedules: LandingSchedule[];
  /** The section's own header, drawn above the cards. */
  header?: React.ReactNode;
}

interface Entry {
  schedule: LandingSchedule;
  span: AgeSpan | null;
}

function whatsAppHref(message: string): string {
  return `${toWhatsAppLink(landingConfig.contact.whatsapp[0])}?text=${encodeURIComponent(message)}`;
}

/** Youngest category first; those without a numeric age keep the API's order, after the rest. */
function orderEntries(schedules: LandingSchedule[]): Entry[] {
  const spans = resolveAgeSpans(schedules.map((schedule): string | undefined => schedule.audience));
  return schedules
    .map((schedule, index): Entry & { index: number } => ({ schedule, span: spans[index], index }))
    .sort((a, b): number => {
      if (a.span !== null && b.span !== null) return a.span.min - b.span.min || a.index - b.index;
      if (a.span !== null) return -1;
      if (b.span !== null) return 1;
      return a.index - b.index;
    });
}

function AgeBar({ span, scale }: { span: AgeSpan; scale: AgeScale }): React.ReactElement {
  const ages = Array.from({ length: scale.to - scale.from + 1 }, (_, offset): number => scale.from + offset);
  return <>
    <div className="landing-schedule-scale" aria-hidden="true" style={{ "--landing-scale-cells": ages.length } as React.CSSProperties}>
      {ages.map((age): React.ReactElement => <i key={age} className={age >= span.min && age <= span.max ? "landing-schedule-scale-on" : undefined} />)}
    </div>
    <div className="landing-schedule-scale-labels" aria-hidden="true">
      <span>{scale.from}</span><span>{scale.to}{scale.plus ? "+" : ""}</span>
    </div>
  </>;
}

export default function ScheduleSelector({ schedules, header }: ScheduleSelectorProps): React.ReactElement {
  const entries = orderEntries(schedules);
  const scale = ageScale(entries.map((entry): AgeSpan | null => entry.span));

  return <div className="landing-schedule-layout">
    {header}

    <ScheduleReveal>
      {entries.map(({ schedule, span }, index): React.ReactElement => {
        const look = CARD_PALETTE[index % CARD_PALETTE.length];
        const [main, ...rest] = schedule.slots;
        return <li
          key={schedule.category} className="landing-schedule-tile"
          style={{
            "--landing-tile": look.ground, "--landing-tile-ink": look.ink,
            "--landing-tile-cta": look.ctaGround, "--landing-tile-cta-ink": look.ctaInk,
            "--landing-tile-index": index,
          } as React.CSSProperties}
        >
          <h3>{schedule.category}</h3>
          {schedule.audience ? <p className="landing-schedule-ages">{span !== null ? <small>Edad</small> : null}{schedule.audience}</p> : null}
          {span !== null && scale !== null ? <AgeBar span={span} scale={scale} /> : null}
          <div className="landing-schedule-body">
            <ul className="landing-schedule-when">
              {[main, ...rest].map((slot, slotIndex): React.ReactElement => (
                <li key={`${slot.hours}-${slotIndex}`} className="landing-schedule-slot">
                  <p className="landing-schedule-time">{slot.hours}</p>
                  <p className="landing-schedule-days">{compactDays(slot.days)}</p>
                </li>
              ))}
            </ul>
            <a
              className="landing-schedule-cta" target="_blank" rel="noreferrer"
              href={whatsAppHref(`Hola, quiero consultar cupo en ${schedule.category}.`)}
              aria-label={`Preguntar por cupos en ${schedule.category} por WhatsApp`}
            >
              Preguntar por cupos <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </li>;
      })}
      <li className="landing-schedule-tile landing-schedule-help" style={{ "--landing-tile-index": entries.length } as React.CSSProperties}>
        <h3>¿No sabe cuál elegir?</h3>
        <p>Escríbanos con la edad y le indicamos la categoría.</p>
        <a href={whatsAppHref("Hola, quiero ayuda para elegir categoría.")} target="_blank" rel="noreferrer">Abrir WhatsApp <ArrowRight aria-hidden="true" /></a>
      </li>
    </ScheduleReveal>

    {scale !== null
      ? <p className="landing-schedule-note">
        La barra de cada tarjeta marca las edades de la categoría ({scale.from} a {scale.to}{scale.plus ? " o más" : ""}). Algunas edades pueden elegir entre dos categorías.
      </p>
      : null}
  </div>;
}
