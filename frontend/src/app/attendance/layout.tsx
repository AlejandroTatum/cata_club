/**
 * Metadata carrier for `/attendance` — see `src/app/dashboard/layout.tsx` for
 * why a client-component route needs a sibling layout to name itself.
 *
 * An admin screen, so it keeps the root template `%s | Cata Club Admin`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Asistencias",
};

export default function AttendanceLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
