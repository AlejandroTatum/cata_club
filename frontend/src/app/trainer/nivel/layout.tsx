/**
 * Metadata carrier for `/trainer/nivel`. Nested under the `/trainer` layout,
 * whose title this one replaces for its own subtree — without it the tab read
 * "Mi día — Cata Club" on a screen that is not Mi día.
 *
 * `title.absolute` — a coach's screen, not an admin panel. See
 * `src/app/trainer/layout.tsx`.
 *
 * "Niveles" is the name the sidebar gives this route and the title the screen
 * prints, and it is the SAME screen the admin opens at `/ranking`, so all
 * three say the one word.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Niveles — Cata Club" },
};

export default function TrainerNivelLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
