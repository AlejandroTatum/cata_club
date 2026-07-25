/**
 * Metadata carrier for `/trainer` — see `src/app/dashboard/layout.tsx` for why
 * a client-component route needs a sibling layout to name itself.
 *
 * `title.absolute`, for the same reason `/student/enroll` uses it: the root
 * template is `%s | Cata Club Admin`, and a coach's screen is not an admin
 * panel. The suffix is kept for the seven admin routes and dropped everywhere
 * the reader is not an administrator.
 *
 * "Mi día" is the name the sidebar already gives this screen, so the tab, the
 * nav and the page's own subtitle all say the same thing.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Mi día — Cata Club" },
};

export default function TrainerLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
