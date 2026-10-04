/**
 * Metadata carrier for `/admin/reportes-error` — see `src/app/reports/layout.tsx` for why a
 * client-component route needs a sibling layout to name itself (LAN-13).
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Errores reportados",
};

export default function ReportesErrorLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
