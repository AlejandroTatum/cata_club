/**
 * Metadata carrier for `/trainer/students`. Nested under the `/trainer`
 * layout, whose title this one replaces for its own subtree — mismo patrón que
 * `src/app/trainer/attendance/layout.tsx`.
 *
 * `title.absolute` con el nombre del registro de destinos, no una variante
 * "más linda": la pestaña, el rail y el control de volver dicen lo mismo.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Alumnos del club — Cata Club" },
};

export default function TrainerStudentsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
