/**
 * Metadata carrier for `/ranking` — see `src/app/dashboard/layout.tsx` for why
 * a client-component route needs a sibling layout to name itself.
 *
 * An admin screen, so it keeps the root template `%s | Cata Club Admin`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Niveles",
};

export default function RankingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
