/**
 * Metadata carrier for `/verificar-correo` — see
 * `src/app/login/activacion/layout.tsx` for why a client-component route
 * needs a sibling layout to name itself.
 *
 * `title.absolute`, same reasoning as that sibling (#1196): this page is
 * reached by a visitor confirming their address, not by staff signing in,
 * and it would otherwise inherit `%s | Cata Club Admin` from the root
 * layout — staff vocabulary shown to a parent finishing their child's
 * enrolment.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Verificación de correo — Cata Club" },
};

export default function VerificarCorreoLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
