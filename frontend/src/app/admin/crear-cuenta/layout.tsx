/**
 * Metadata carrier for `/admin/crear-cuenta` — see
 * `src/app/dashboard/layout.tsx` for why a client-component route needs a
 * sibling layout to name itself.
 *
 * Issue #489: `page.tsx` is `"use client"`, so Next never read a `metadata`
 * export from it, and the wizard had no `layout.tsx` of its own either. The
 * tab sat on the root layout's bare default, "Cata Club Admin", through all
 * 5 steps — a query-string wizard, so no step ever triggers a server render
 * that could pick a new title regardless.
 *
 * An admin screen, so it keeps the root template `%s | Cata Club Admin`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

export default function CrearCuentaLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
