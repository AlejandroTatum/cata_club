/**
 * Metadata carrier for `/payments` — see `src/app/dashboard/layout.tsx` for why
 * a client-component route needs a sibling layout to name itself.
 *
 * An admin screen, so it keeps the root template `%s | Cata Club Admin`.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Membresías y Pagos",
};

export default function PaymentsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
