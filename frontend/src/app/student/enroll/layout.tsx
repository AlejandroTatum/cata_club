/**
 * Metadata carrier for `/student/enroll`.
 *
 * page.tsx is a client component (`"use client"`), and Next.js only reads
 * `metadata` from server components — so the wizard's own title has to live
 * in a sibling layout. Without this the tab and every shared link read
 * "Cata Club Admin", the root layout's default.
 *
 * `title.absolute` for the same reason src/app/page.tsx uses it: this is a
 * public, family-facing page, and the root template `%s | Cata Club Admin`
 * would brand it as an internal admin panel.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Inscripción — Cata Club" },
  description:
    "Inscríbete en Cata Club, club formativo de tenis de mesa en Loja, Ecuador. Completa la inscripción en línea como jugador o como representante de un estudiante.",
  openGraph: {
    type: "website",
    locale: "es_EC",
    siteName: "Cata Club",
    title: "Inscripción — Cata Club",
    description:
      "Completa la inscripción en línea en Cata Club: como jugador o como representante de un estudiante.",
  },
};

export default function EnrollLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
