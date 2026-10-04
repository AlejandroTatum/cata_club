/**
 * Metadata carrier for `/dashboard`.
 *
 * page.tsx is a client component (`"use client"`), and Next.js only reads
 * `metadata` from server components — so the route's own title has to live in
 * a sibling layout. Same pattern as `src/app/student/enroll/layout.tsx`.
 *
 * Without one, every authenticated route inherited the root default and the
 * whole app answered "Cata Club Admin": indistinguishable tabs, and a history
 * list where no entry says where it goes.
 *
 * The title goes through the root template `%s — Cata Club`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Panel de control",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
