/**
 * Metadata carrier for `/student` — see `src/app/dashboard/layout.tsx` for why
 * a client-component route needs a sibling layout to name itself.
 *
 * `title.absolute`, exactly as `/student/enroll` already does: this is the
 * family portal, and branding a student's or a guardian's tab "Cata Club
 * Admin" tells them they are somewhere they are not.
 *
 * `/student/enroll` and `/student/add-dependent` carry their own layouts and
 * override this title for their subtrees.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Mi cuenta — Cata Club" },
};

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
