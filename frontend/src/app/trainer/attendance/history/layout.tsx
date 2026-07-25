/**
 * Metadata carrier for `/trainer/attendance/history`. Nested under the
 * `/trainer/attendance` layout, whose title this one replaces.
 *
 * `title.absolute` — a coach's screen, not an admin panel. See
 * `src/app/trainer/layout.tsx`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Historial de asistencias — Cata Club" },
};

export default function TrainerAttendanceHistoryLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
