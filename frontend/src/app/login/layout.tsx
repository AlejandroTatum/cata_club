/**
 * Metadata carrier for `/login` — see `src/app/student/layout.tsx` for why a
 * client-component route needs a sibling layout to name itself.
 *
 * `title.absolute`, not the root template (#1195): `/login` is the first
 * screen a family reaches, and `%s | Cata Club Admin` told them they were
 * about to enter a staff panel. Its tab, and every shared link, now reads
 * the plain club name.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Iniciar sesión — Cata Club" },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
