"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { LandingSchedule } from "./landing-config";
import { barGeometry, deriveDayRange, type DayRange } from "./schedule-timeline";

/** One accent per category; all six come from the page's own palette. */
const CATEGORY_COLORS = [
  "var(--landing-brand-red)",
  "var(--landing-brand-yellow)",
  "var(--landing-brand-fuchsia)",
  "var(--landing-ball)",
  "var(--landing-brand-red-strong)",
  "var(--landing-brand-fuchsia-strong)",
] as const;

const DAY_TRACK_LABEL = "Distribución de las categorías según sus horarios publicados";

interface ScheduleSelectorProps {
  schedules: LandingSchedule[];
}

function categoryTimes(schedule: LandingSchedule): string[] {
  const seen = new Set<string>();
  return schedule.slots
    .map((slot): string => slot.hours.replace(/\s/g, ""))
    .filter((hours): boolean => {
      if (seen.has(hours)) return false;
      seen.add(hours);
      return true;
    });
}

/** Distinct day labels joined with " y ", matching the prototype's panel fact. */
function categoryDays(schedule: LandingSchedule): string {
  const seen = new Set<string>();
  return schedule.slots
    .map((slot): string => slot.days)
    .filter((days): boolean => {
      if (seen.has(days)) return false;
      seen.add(days);
      return true;
    })
    .join(" y ");
}

export default function ScheduleSelector({ schedules }: ScheduleSelectorProps): React.ReactElement {
  const [selected, setSelected] = useState(0);
  const [marker, setMarker] = useState({ top: 0, height: 0 });
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const range: DayRange = deriveDayRange(schedules);
  const active = schedules[selected] ?? schedules[0];
  const rows = Array.from(
    schedules
      .flatMap((schedule): LandingSchedule["slots"] => schedule.slots)
      .reduce((groups, slot): Map<string, string[]> => {
        const labels = groups.get(slot.on) ?? [];
        if (!labels.includes(slot.days)) labels.push(slot.days);
        groups.set(slot.on, labels);
        return groups;
      }, new Map<string, string[]>()),
  );

  /*
   * Keep the single marker element aligned with the selected tab. Measured
   * imperatively because `offsetTop`/`offsetHeight` only exist after layout;
   * the CSS `transition` on the marker smooths the move for free.
   */
  useEffect((): void => {
    const tab = tabRefs.current[selected];
    if (!tab) return;
    setMarker({ top: tab.offsetTop + 10, height: Math.max(0, tab.offsetHeight - 20) });
  }, [selected]);

  const select = (index: number): void => {
    setSelected(index);
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    let next = -1;
    if (event.key === "ArrowDown") next = selected + 1;
    else if (event.key === "ArrowUp") next = selected - 1;
    else return;
    if (next < 0 || next >= schedules.length) return;
    event.preventDefault();
    select(next);
  };

  const renderBars = (which: "week" | "sat"): React.ReactElement[] => {
    const bars: React.ReactElement[] = [];
    schedules.forEach((schedule, categoryIndex): void => {
      schedule.slots.forEach((slot, slotIndex): void => {
        if (slot.on !== which) return;
        const geometry = barGeometry(slot.hours, range);
        bars.push(
          <span
            key={`${schedule.category}-${slotIndex}-${slot.on}`}
            className="landing-day-bar"
            data-on={String(schedule.category === active?.category)}
            title={`${schedule.category} · ${slot.hours} · ${slot.days}`}
            style={{
              left: `${geometry.left.toFixed(3)}%`,
              width: `calc(${geometry.width.toFixed(3)}% - 3px)`,
              "--landing-cat": CATEGORY_COLORS[categoryIndex % CATEGORY_COLORS.length],
            } as React.CSSProperties}
          />,
        );
      });
    });
    return bars;
  };

  return (
    <div className="landing-sched">
      <div className="landing-sched-list-wrap">
        <span
          className="landing-sched-marker"
          aria-hidden="true"
          style={{ top: marker.top, height: marker.height }}
        />
        <div
          className="landing-sched-list"
          role="tablist"
          aria-label="Categorías"
          aria-orientation="vertical"
          onKeyDown={onKeyDown}
        >
          {schedules.map((schedule, index): React.ReactElement => (
            <button
              key={schedule.category}
              type="button"
              role="tab"
              id={`schedule-tab-${index}`}
              ref={(element): void => {
                tabRefs.current[index] = element;
              }}
              aria-selected={index === selected}
              aria-controls="schedule-panel"
              tabIndex={index === selected ? 0 : -1}
              style={{ "--landing-cat": CATEGORY_COLORS[index % CATEGORY_COLORS.length] } as React.CSSProperties}
              onClick={(): void => select(index)}
            >
              <i className="landing-cat-dot" aria-hidden="true" />
              <span>
                <strong>{schedule.category}</strong>
                {schedule.audience ? <span>{schedule.audience}</span> : null}
              </span>
              <em>
                {categoryTimes(schedule).map((time, timeIndex): React.ReactElement => (
                  <Fragment key={time}>
                    {timeIndex > 0 ? <br /> : null}
                    {time}
                  </Fragment>
                ))}
              </em>
            </button>
          ))}
        </div>
      </div>

      <div
        className="landing-sched-panel"
        role="tabpanel"
        id="schedule-panel"
        aria-labelledby={`schedule-tab-${selected}`}
      >
        <h3>{active.category}</h3>
        <div className="landing-sched-facts">
          {active.audience ? <span className="landing-sched-fact"><small>Edad</small><b>{active.audience}</b></span> : null}
          <span className="landing-sched-fact">
            <small>Horario</small>
            <b>{active.slots.map((slot): string => slot.hours).join("  ·  ")}</b>
          </span>
          <span className="landing-sched-fact"><small>Días</small><b>{categoryDays(active)}</b></span>
        </div>

        <div className="landing-day">
          <div className="landing-day-track" role="img" aria-label={DAY_TRACK_LABEL}>
            {rows.map(([on, labels]): React.ReactElement => (
              <div className="landing-day-row" key={on} data-day-row={on}>
                <b>{labels.join(" y ")}</b>
                <div className="landing-day-lane" data-day-lane={on}>{renderBars(on as "week" | "sat")}</div>
              </div>
            ))}
          </div>
        </div>

        <a className="landing-button" href="#contacto">
          Consultar cupo por WhatsApp <ArrowRight aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
