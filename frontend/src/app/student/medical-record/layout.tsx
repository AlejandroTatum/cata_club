/**
 * Metadata carrier for `/student/medical-record` — see
 * `src/app/dashboard/layout.tsx` for why a client-component route needs a
 * sibling layout to name itself, and `/student/attendance`'s layout for the
 * same pattern inside the family portal.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Ficha médica — Cata Club" },
};

export default function StudentMedicalRecordLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
