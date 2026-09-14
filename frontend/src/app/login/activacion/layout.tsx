/**
 * Metadata carrier for `/login/activacion` — see `src/app/student/layout.tsx`
 * for why a client-component route needs a sibling layout to name itself.
 *
 * `title.absolute`, not `/login/layout.tsx`'s own override (#1195): this
 * gate is reached by an authenticated visitor, not the sign-in form, and it
 * inherited `%s | Cata Club Admin` from the root layout before either
 * override existed — staff vocabulary shown to a parent finishing their
 * child's enrolment.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Verifique su cuenta — Cata Club" },
};

export default function ActivacionLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
