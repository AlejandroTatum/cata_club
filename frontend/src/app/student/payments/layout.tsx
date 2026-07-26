/**
 * Metadata carrier for `/student/payments`. Nested under the `/student`
 * layout, whose title this one replaces — without it the payments screen
 * announced itself as "Mi cuenta" in the browser tab.
 *
 * `title.absolute` — family portal, not the admin panel. See
 * `src/app/student/layout.tsx`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Pagos — Cata Club" },
};

export default function StudentPaymentsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
