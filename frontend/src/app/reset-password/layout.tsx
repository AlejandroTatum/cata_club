/**
 * Metadata carrier for `/reset-password` — see `src/app/student/layout.tsx`
 * for why a client-component route needs a sibling layout to name itself.
 *
 * `title.absolute`, not the root template (#1209): this screen is reached
 * by a visitor setting a new password from an email link, and
 * `%s | Cata Club Admin` told them they were about to enter a staff panel.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Restablecer contraseña — Cata Club" },
};

export default function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
