"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { LandingSchedule } from "./landing-config";
import { barGeometry, deriveDayRange, type DayRange } from "./schedule-timeline";

const CATEGORY_COLORS = [
  "var(--landing-brand-red)", "var(--landing-brand-yellow)", "var(--landing-brand-fuchsia)",
  "var(--landing-ball)", "var(--landing-brand-red-strong)", "var(--landing-brand-fuchsia-strong)",
] as const;
const DAY_TRACK_LABEL = "Distribución de los horarios de la categoría seleccionada";
type DayGroup = "week" | "sat" | "sun" | "custom";
const DAY_NAMES: Array<{ name: string; short: string; group: DayGroup }> = [
  { name: "Lunes", short: "LUN", group: "week" }, { name: "Martes", short: "MAR", group: "week" },
  { name: "Miércoles", short: "MIÉ", group: "week" }, { name: "Jueves", short: "JUE", group: "week" },
  { name: "Viernes", short: "VIE", group: "week" }, { name: "Sábado", short: "SÁB", group: "sat" },
  { name: "Domingo", short: "DOM", group: "sun" },
];

function dayGroups(days: string): Array<{ key: DayGroup; label: string }> {
  const present = DAY_NAMES.filter(({ name }): boolean => days.includes(name));
  const weekdays = present.filter(({ group }): boolean => group === "week");
  const groups: Array<{ key: DayGroup; label: string }> = [];
  if (weekdays.length > 0) groups.push({ key: "week", label: days.includes("Lunes a Viernes") || weekdays.length === 5 ? "LUN–VIE" : weekdays.map(({ short }): string => short).join(", ") });
  present.filter(({ group }): boolean => group === "sat" || group === "sun").forEach(({ group, short }): void => {
    if (!groups.some(({ key }): boolean => key === group)) groups.push({ key: group, label: short });
  });
  return groups.length > 0 ? groups : [{ key: "custom", label: days }];
}

interface ScheduleSelectorProps { schedules: LandingSchedule[] }
function categoryTimes(schedule: LandingSchedule): string[] {
  const seen = new Set<string>();
  return schedule.slots.map((slot): string => slot.hours.replace(/\s/g, "")).filter((hours): boolean => {
    if (seen.has(hours)) return false;
    seen.add(hours);
    return true;
  });
}
function categoryDays(schedule: LandingSchedule): string {
  const seen = new Set<string>();
  return schedule.slots.map((slot): string => slot.days).filter((days): boolean => {
    if (seen.has(days)) return false;
    seen.add(days);
    return true;
  }).join(" y ");
}

export default function ScheduleSelector({ schedules }: ScheduleSelectorProps): React.ReactElement {
  const [selected, setSelected] = useState(0);
  const [marker, setMarker] = useState({ top: 0, height: 0 });
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const range: DayRange = deriveDayRange(schedules);
  const active = schedules[selected] ?? schedules[0];
  const rows = Array.from((active?.slots ?? []).reduce((groups, slot): Map<DayGroup, string> => {
    dayGroups(slot.days).forEach(({ key, label }): void => { if (!groups.has(key)) groups.set(key, label); });
    return groups;
  }, new Map<DayGroup, string>()));

  useEffect((): void => {
    const tab = tabRefs.current[selected];
    if (tab) setMarker({ top: tab.offsetTop + 10, height: Math.max(0, tab.offsetHeight - 20) });
  }, [selected]);
  const select = (index: number): void => { setSelected(index); tabRefs.current[index]?.focus(); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const next = event.key === "ArrowDown" ? selected + 1 : event.key === "ArrowUp" ? selected - 1 : -1;
    if (next < 0 || next >= schedules.length) return;
    event.preventDefault(); select(next);
  };
  const renderBars = (which: DayGroup): React.ReactElement[] => (active?.slots ?? []).flatMap((slot, slotIndex): React.ReactElement[] => {
    if (!dayGroups(slot.days).some(({ key }): boolean => key === which)) return [];
    const geometry = barGeometry(slot.hours, range);
    return [<span key={`${active.category}-${slotIndex}-${which}`} className="landing-day-bar" data-on="true"
      title={`${active.category} · ${slot.hours} · ${slot.days}`} style={{ left: `${geometry.left.toFixed(3)}%`, width: `calc(${geometry.width.toFixed(3)}% - 3px)`, "--landing-cat": CATEGORY_COLORS[selected % CATEGORY_COLORS.length] } as React.CSSProperties} />];
  });

  return <div className="landing-sched">
    <div className="landing-sched-list-wrap"><span className="landing-sched-marker" aria-hidden="true" style={{ top: marker.top, height: marker.height }} />
      <div className="landing-sched-list" role="tablist" aria-label="Categorías" aria-orientation="vertical" onKeyDown={onKeyDown}>
        {schedules.map((schedule, index): React.ReactElement => <button key={schedule.category} type="button" role="tab" id={`schedule-tab-${index}`} ref={(element): void => { tabRefs.current[index] = element; }} aria-selected={index === selected} aria-controls="schedule-panel" tabIndex={index === selected ? 0 : -1} style={{ "--landing-cat": CATEGORY_COLORS[index % CATEGORY_COLORS.length] } as React.CSSProperties} onClick={(): void => select(index)}>
          <i className="landing-cat-dot" aria-hidden="true" /><span><strong>{schedule.category}</strong>{schedule.audience ? <span>{schedule.audience}</span> : null}</span><em>{categoryTimes(schedule).map((time, timeIndex): React.ReactElement => <Fragment key={time}>{timeIndex > 0 ? <br /> : null}{time}</Fragment>)}</em>
        </button>)}
      </div>
    </div>
    <div className="landing-sched-panel" role="tabpanel" id="schedule-panel" aria-labelledby={`schedule-tab-${selected}`}>
      <h3>{active.category}</h3><div className="landing-sched-facts">{active.audience ? <span className="landing-sched-fact"><small>Edad</small><b>{active.audience}</b></span> : null}<span className="landing-sched-fact"><small>Horario</small><b>{active.slots.map((slot): string => slot.hours).join("  ·  ")}</b></span><span className="landing-sched-fact"><small>Días</small><b>{categoryDays(active)}</b></span></div>
      <div className="landing-day"><div className="landing-day-track" role="img" aria-label={DAY_TRACK_LABEL}>{rows.map(([on, label]): React.ReactElement => <div className="landing-day-row" key={on} data-day-row={on}><b>{label}</b><div className="landing-day-lane" data-day-lane={on}>{renderBars(on)}</div></div>)}</div></div>
      <a className="landing-button" href="#contacto">Consultar cupo por WhatsApp <ArrowRight aria-hidden="true" /></a>
    </div>
  </div>;
}
