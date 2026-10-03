/**
 * What a signed-in user sees instead of the enrollment wizard (REG-11).
 *
 * The wizard creates a NEW account. Someone who already has a session cannot
 * meaningfully use it — adding a person under their own account is the
 * "Agregar un dependiente" flow — so the wizard is replaced by a notice that
 * offers the two honest ways forward.
 */
import type { ReactElement } from "react";
import Link from "next/link";
import { BackLink, Button, buttonClasses } from "@/components/ui";

export interface EnrollSignedInNoticeProps {
  backHref: string;
  onLogout: () => void;
  loggingOut: boolean;
}

export default function EnrollSignedInNotice(props: EnrollSignedInNoticeProps): ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <BackLink href={props.backHref} />
      <section className="flex flex-col gap-4 rounded-card border border-line bg-white p-page shadow-elevated">
        <h1 className="font-display text-2xl uppercase tracking-flat text-coal">
          Ya tiene una sesión iniciada
        </h1>
        <p className="text-sm text-ink-2">
          La inscripción crea una cuenta nueva. Para sumar a otra persona a su cargo, agregue un
          dependiente. Si desea inscribir a una persona con su propia cuenta, cierre sesión primero.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href="/student/add-dependent" className={buttonClasses("primary")}>
            Agregar un dependiente
          </Link>
          <Button variant="secondary" onClick={props.onLogout} disabled={props.loggingOut}>
            Cerrar sesión para inscribir a otra persona
          </Button>
        </div>
      </section>
    </div>
  );
}
