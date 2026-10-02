/**
 * Metadata carrier for `/admin/actividad`.
 *
 * page.tsx is a client component, and Next.js only reads `metadata` from
 * server components, so the route's title lives in this sibling layout (same
 * pattern as `app/admin/crear-cuenta/layout.tsx`).
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Actividad del club",
};

export default function ActividadLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
