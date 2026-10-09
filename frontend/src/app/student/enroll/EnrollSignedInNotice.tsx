/**
 * What a signed-in user sees instead of the enrollment wizard (REG-11).
 *
 * The wizard creates a NEW account. Someone who already has a session cannot
 * meaningfully use it — adding a person under their own account is the
 * "Agregar un dependiente" flow — so the wizard is replaced by a notice that
 * offers the two honest ways forward.
 *
 * It is drawn inside `AppShell` like every other signed-in student screen: the
 * visitor has a session, so they get the sidebar, theme toggle and account
 * menu instead of a bare grey page (T14 RC13). The public wizard itself stays
 * shell-less.
 */
import type { ReactElement } from "react";
import Link from "next/link";
import AppShell from "@/components/shell/AppShell";
import { BackLink, Button, buttonClasses } from "@/components/ui";

export interface EnrollSignedInNoticeProps {
  backHref: string;
  onLogout: () => void;
  loggingOut: boolean;
}

export default function EnrollSignedInNotice(props: EnrollSignedInNoticeProps): ReactElement {
  return (
    <AppShell
      title="Ya tienes una sesión iniciada"
      back={<BackLink href={props.backHref} />}
    >
      <section className="flex max-w-xl flex-col gap-4 rounded-card border-2 border-edge bg-paper p-page shadow-sticker">
        <p className="text-sm text-ink-2">
          La inscripción crea una cuenta nueva. Para sumar a otra persona a tu cargo, agrega un
          jugador. Si quieres inscribir a una persona con tu propia cuenta, cierra sesión primero.
        </p>
        {/* Both actions have long labels: they stack full width on a phone and
            wrap their text instead of running past the card edge. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Link
            href="/student/add-dependent"
            className={buttonClasses("primary", "md", "!h-auto min-h-ctl w-full !whitespace-normal py-2 text-center sm:w-auto")}
          >
            Agregar jugador (menor de edad)
          </Link>
          <Button
            variant="secondary"
            onClick={props.onLogout}
            disabled={props.loggingOut}
            className="!h-auto min-h-ctl w-full !whitespace-normal py-2 text-center sm:w-auto"
          >
            Cerrar sesión para inscribir a otra persona
          </Button>
        </div>
      </section>
    </AppShell>
  );
}
