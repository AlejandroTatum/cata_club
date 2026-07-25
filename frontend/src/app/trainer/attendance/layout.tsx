/**
 * Metadata carrier for `/trainer/attendance`. Nested under the `/trainer`
 * layout, whose title this one replaces for its own subtree.
 *
 * `title.absolute` — a coach's screen, not an admin panel. See
 * `src/app/trainer/layout.tsx`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Pasar lista — Cata Club" },
};

export default function TrainerAttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
