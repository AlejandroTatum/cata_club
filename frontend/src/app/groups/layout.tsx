/**
 * Metadata carrier for `/groups` — see `src/app/dashboard/layout.tsx` for why
 * a client-component route needs a sibling layout to name itself.
 *
 * An admin screen, so it keeps the root template `%s | Cata Club Admin`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Horarios",
};

export default function GroupsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
