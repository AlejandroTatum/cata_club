/**
 * Metadata carrier for `/student/add-dependent`. Nested under the `/student`
 * layout, whose title this one replaces.
 *
 * `title.absolute` — family portal, not the admin panel. See
 * `src/app/student/layout.tsx`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Agregar dependiente — Cata Club" },
};

export default function AddDependentLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
