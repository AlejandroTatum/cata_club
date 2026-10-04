/**
 * Metadata carrier for `/sponsors` — see `src/app/reports/layout.tsx` for why a
 * client-component route needs a sibling layout to name itself (LAN-13).
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Patrocinadores",
};

export default function SponsorsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
