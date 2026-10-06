"use client";

import { useEffect, useState } from "react";
import { CalendarOff } from "lucide-react";
import { InfoPanel } from "@/components/ui";
import { clubIsoDate } from "@/lib/club-date";
import { ICON } from "@/lib/icon-size";
import { formatNoClassRange, upcomingNoClassDays } from "@/lib/no-class-days";
import { fetchDiasSinClase, type DiaSinClase } from "@/services/api";

/**
 * The club's upcoming no-class days (issue #1665), for signed-in members only.
 *
 * Whole-club by the owner's decision, so it is not tied to the selected
 * dependent. Best-effort: with nothing announced, or when the lookup fails,
 * it renders nothing — a failed side lookup must never take the account page
 * with it, and "no announcements" is not something to fill a card with.
 */
export default function NoClassDays(): React.ReactElement | null {
  const [days, setDays] = useState<DiaSinClase[]>([]);

  useEffect(() => {
    let cancelled = false;
    const hoy = clubIsoDate();
    fetchDiasSinClase({ desde: hoy })
      .then((all) => {
        if (!cancelled) setDays(upcomingNoClassDays(all, hoy));
      })
      .catch(() => {
        if (!cancelled) setDays([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (days.length === 0) return null;

  return (
    <InfoPanel title="Días sin clase">
      <ul className="flex flex-col gap-2">
        {days.map((day) => (
          <li key={day.id} className="flex items-start gap-2">
            <CalendarOff size={ICON.sm} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
            <span className="min-w-0">
              <span className="font-semibold text-ink">{formatNoClassRange(day)}</span>
              {" · "}
              <span className="break-words">{day.motivo}</span>
            </span>
          </li>
        ))}
      </ul>
    </InfoPanel>
  );
}
