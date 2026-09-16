/**
 * Metadata carrier for `/forgot-password` — see `src/app/student/layout.tsx`
 * for why a client-component route needs a sibling layout to name itself.
 *
 * `title.absolute`, not the root template (#1209): this screen is reached
 * by a visitor recovering a forgotten password, and `%s | Cata Club Admin`
 * told them they were about to enter a staff panel.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Recuperar contraseña — Cata Club" },
};

export default function ForgotPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
