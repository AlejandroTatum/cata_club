/**
 * Metadata carrier for `/members/carnets` — see `src/app/dashboard/layout.tsx`
 * for why a client-component route needs a sibling layout to name itself.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Carnets",
};

export default function CarnetsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
