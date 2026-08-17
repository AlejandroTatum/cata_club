/**
 * Metadata carrier for `/ayuda` — see `src/app/student/layout.tsx` for why a
 * client-component route needs a sibling layout to name itself.
 *
 * `title.absolute`, not the root template: `/ayuda` is reachable by every
 * role — an alumna's tab measured `document.title` as the bare root default
 * "Cata Club Admin" (#315 hallazgo #47), the wrong brand for an account with
 * no admin access at all, and the only tab in the portal that could not be
 * told apart from the others.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Preguntas frecuentes — Cata Club" },
};

export default function AyudaLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
