/**
 * BirthdaysToday — the players who have a birthday today, with the age they
 * turn. A small block of the admin dashboard: when nobody does, it says so in
 * one line (`CompactEmpty`) instead of leaving a hole.
 */

import type { ReactElement } from "react";
import { ActivityItem, ActivityList } from "@/components/ui";
import { initialsFor } from "@/app/dashboard/dashboard-utils";
import type { BirthdayToday } from "@/services/api";
import CompactEmpty from "./CompactEmpty";
import DashboardSection from "./DashboardSection";

export interface BirthdaysTodayProps {
  birthdays: BirthdayToday[];
}

export default function BirthdaysToday({ birthdays }: BirthdaysTodayProps): ReactElement {
  return (
    <DashboardSection title="Cumpleaños de hoy" testId="birthdays-today">
      {birthdays.length > 0 ? (
        <ActivityList>
          {birthdays.map((birthday) => (
            <ActivityItem
              key={`${birthday.nombre}-${birthday.edad}`}
              initials={initialsFor(birthday.nombre)}
              subject={birthday.nombre}
              detail={`cumple ${birthday.edad}`}
              at=""
            />
          ))}
        </ActivityList>
      ) : (
        <CompactEmpty title="Hoy no hay cumpleaños" />
      )}
    </DashboardSection>
  );
}
