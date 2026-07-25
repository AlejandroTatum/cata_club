/**
 * Metadata carrier for `/profile` — see `src/app/dashboard/layout.tsx` for why
 * a client-component route needs a sibling layout to name itself.
 *
 * `title.absolute`: this route is reached by every role, students and
 * guardians included, so the `%s | Cata Club Admin` template would be wrong
 * for most of the people who open it.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Perfil — Cata Club" },
};

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
