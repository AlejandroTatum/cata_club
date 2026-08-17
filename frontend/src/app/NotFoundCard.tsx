/**
 * NotFoundCard — the body `not-found.tsx` renders.
 *
 * Same composition as `/unauthorized` (issue #316 hallazgo #55 is the same
 * defect one level up: an account with nowhere real to land, this time
 * because the URL itself is wrong rather than the role). Reused deliberately
 * rather than drawing a second "one card, centred" shell: `main-landmark.test.ts`
 * already keeps that list closed, and this is the same shape, not a new one.
 *
 * `backHrefForRole` — not a hardcoded `/` — is what makes "a camino de vuelta
 * a Mi cuenta" true for the role that actually hit the dead link: an admin
 * who mistypes a URL lands on "Volver al Panel de Control", not on the public
 * site. `/ayuda` reads the same helper for the same reason. A signed-out
 * visitor (or a session still hydrating) falls back to "/", same as there.
 */

"use client";

import Image from "next/image";
import { BackLink } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { backHrefForRole } from "@/lib/auth-utils";

export default function NotFoundCard(): React.ReactElement {
  const { session } = useAuth();

  return (
    // This route reaches the user through no shell, so — like /unauthorized —
    // it declares its own landmark rather than borrowing the root layout's.
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="flex w-full max-w-[440px] flex-col items-center gap-3.5 rounded-[18px] border border-line bg-paper px-8 py-10 text-center shadow-hero">
        <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-full bg-coal">
          <Image
            src="/brand/cata-club-logo.jpeg"
            alt="Cata Club"
            fill
            sizes="64px"
            className="object-cover"
            priority
          />
        </span>

        <h1 className="m-0 text-balance font-display text-lg uppercase tracking-flat text-ink">
          No encontramos esta página
        </h1>

        <p className="m-0 text-sm leading-relaxed text-ink-3">
          La dirección puede estar mal escrita o el enlace puede haber cambiado. Vuelva a un
          lugar conocido del portal.
        </p>

        <div className="mt-1.5 flex justify-center">
          <BackLink href={backHrefForRole(session?.user.role)} />
        </div>
      </div>
    </main>
  );
}
