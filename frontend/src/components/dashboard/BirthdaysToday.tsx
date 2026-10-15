/**
 * BirthdaysToday — the players who have a birthday today, with the age they
 * turn. A small block of the admin dashboard: the list is paged (a club-wide
 * birthday can be dozens of names) and the header carries the total; when
 * nobody has a birthday it says so in one line (`CompactEmpty`) instead of
 * leaving a hole.
 */

"use client";

import { useState } from "react";
import type { ReactElement } from "react";
import { ActivityItem, ActivityList, Pagination } from "@/components/ui";
import { initialsFor } from "@/app/dashboard/dashboard-utils";
import type { BirthdayToday } from "@/services/api";
import CompactEmpty from "./CompactEmpty";
import DashboardSection from "./DashboardSection";

/** Rows per page: the card stays compact next to its neighbours. */
export const BIRTHDAYS_PAGE_SIZE = 5;

export interface BirthdaysTodayProps {
  birthdays: BirthdayToday[];
}

export default function BirthdaysToday({ birthdays }: BirthdaysTodayProps): ReactElement {
  const [page, setPage] = useState(1);
  const total = birthdays.length;
  const totalPages = Math.max(1, Math.ceil(total / BIRTHDAYS_PAGE_SIZE));
  // Clamp: the list can shrink under the reader (a refetch) while on a late page.
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * BIRTHDAYS_PAGE_SIZE;
  const visible = birthdays.slice(start, start + BIRTHDAYS_PAGE_SIZE);

  return (
    <DashboardSection
      title={total > 0 ? `Cumpleaños de hoy (${total})` : "Cumpleaños de hoy"}
      testId="birthdays-today"
    >
      {total > 0 ? (
        <>
          <ActivityList>
            {visible.map((birthday, index) => (
              <ActivityItem
                key={`${start + index}-${birthday.nombre}`}
                initials={initialsFor(birthday.nombre)}
                subject={birthday.nombre}
                detail={`cumple ${birthday.edad}`}
                at=""
              />
            ))}
          </ActivityList>
          {totalPages > 1 && (
            <Pagination
              variant="footer"
              page={currentPage}
              totalPages={totalPages}
              onPageChange={setPage}
              totalItems={total}
              pageSize={BIRTHDAYS_PAGE_SIZE}
              itemNoun="jugador"
            />
          )}
        </>
      ) : (
        <CompactEmpty title="Hoy no hay cumpleaños" />
      )}
    </DashboardSection>
  );
}
