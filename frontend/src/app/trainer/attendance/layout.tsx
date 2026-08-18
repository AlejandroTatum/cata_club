/**
 * Metadata carrier for the `/trainer/attendance` segment. Nested under the
 * `/trainer` layout, whose title this one replaces for its own subtree.
 *
 * There is no page at `/trainer/attendance` itself: the roll-call wizard that
 * used to render here was deleted while it is rebuilt inside the Members area.
 * What is left under this segment is `/trainer/attendance/history`, which
 * carries its own absolute title in `history/layout.tsx`; the title below is
 * the segment's fallback, naming the records rather than the act of taking
 * them.
 *
 * `title.absolute` — a coach's screen, not an admin panel. See
 * `src/app/trainer/layout.tsx`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Asistencias — Cata Club" },
};

export default function TrainerAttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
