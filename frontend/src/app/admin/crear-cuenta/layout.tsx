/**
 * Metadata carrier for the retired `/admin/crear-cuenta` redirect.
 * The layout remains so old bookmarks do not inherit a stale wizard title.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Miembros",
};

export default function CrearCuentaLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
