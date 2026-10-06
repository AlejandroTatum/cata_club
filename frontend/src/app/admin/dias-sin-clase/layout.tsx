/**
 * Metadata carrier for `/admin/dias-sin-clase` — see `src/app/reports/layout.tsx` for why a
 * client-component route needs a sibling layout to name itself (LAN-13).
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Días sin clase",
};

export default function DiasSinClaseLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
