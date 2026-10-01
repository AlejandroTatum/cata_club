/**
 * The enrollment-confirmed screen.
 *
 * It used to be a 560px card centred on an otherwise empty canvas. The page is
 * now a two-part composition that uses the width the viewport gives it:
 *
 *   · a hero card — the welcome, the student, the actions — beside a real club
 *     photograph (stacked, photo first, on a phone); and
 *   · "Qué sigue" as numbered cards in columns on desktop, two-up on tablet and
 *     stacked on a phone, so the order reads left to right instead of down a
 *     single bullet list.
 *
 * Every claim on it is the one the card carried before. The session half of the
 * first step is a CLAIM and is only made when `sessionConfirmed` (issue #717);
 * the delivery of the verification email is never promised (issue #1398).
 */
import type { ReactElement } from "react";
import Image from "next/image";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui";
import { ICON } from "@/lib/icon-size";

interface NextStep {
  title: string;
  body: string;
}

export interface EnrollConfirmationProps {
  studentName: string;
  isSelf: boolean;
  sessionConfirmed: boolean;
  /** The alert text when the post-enrollment session was not confirmed. */
  sessionNotice: string | null;
  /** `null` while the session is unconfirmed: the honest destination is /login. */
  accountAreaLink: { href: string; label: string } | null;
  onReset: () => void;
}

function nextSteps(sessionConfirmed: boolean): NextStep[] {
  return [
    {
      title: "Su cuenta",
      body: sessionConfirmed
        ? "Su cuenta ya está creada y la sesión, iniciada."
        : "Su cuenta ya está creada. Inicie sesión con su correo y su contraseña.",
    },
    {
      title: "Su correo",
      body: "Verifique su correo: registramos el envío de un enlace de confirmación; puede tardar unos minutos en llegar. Si no llega, reenvíelo desde la pantalla de activación, donde también puede corregir el correo.",
    },
    {
      title: "El club",
      body: "Acérquese a administración o escríbanos por WhatsApp para registrar la inscripción y el primer pago.",
    },
    {
      title: "Su membresía",
      body: "El club lo valida y ahí se activa la membresía.",
    },
  ];
}

export default function EnrollConfirmation(props: EnrollConfirmationProps): ReactElement {
  const { sessionConfirmed, sessionNotice, accountAreaLink } = props;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-page px-4">
      <section className="card overflow-hidden">
        {/* The coal shoulder: the one moment the wizard speaks in the club's
            own colours. Full width, above both halves, so it leads on a phone. */}
        <div className="flex justify-end bg-coal px-page py-2">
          <span className="text-2xs font-bold uppercase text-ball">
            ¡Le damos la bienvenida a Cata Club!
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <figure className="relative order-first aspect-[16/9] min-h-52 bg-coal lg:order-last lg:aspect-auto lg:min-h-[26rem]">
          <Image
            src="/landing/hero-community.jpg"
            alt="Estudiantes, entrenadores y familias de Cata Club reunidos en el club"
            fill
            priority
            sizes="(min-width: 1152px) 560px, 100vw"
            className="object-cover"
            style={{ objectPosition: "50% 70%" }}
          />
          <figcaption className="absolute inset-x-0 bottom-0 bg-coal/70 px-4 py-2 text-sm font-semibold text-white">
            La familia de Cata Club
          </figcaption>
        </figure>

        <div className="flex min-w-0 flex-col">
          <div className="flex flex-1 flex-col justify-center gap-page p-page lg:p-10">
            <div className="flex flex-col items-start gap-section">
              <span
                aria-hidden="true"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-state-ok-bg"
              >
                <CheckCircle size={ICON.lg} className="text-state-ok" strokeWidth={1.5} />
              </span>
              <h1 className="font-display text-xl uppercase tracking-flat text-ink lg:text-2xl">
                Inscripción completada
              </h1>
              {/* #877: a contained emotional line, not a second claim — it says
                  nothing about membership, payment or session. */}
              <p className="max-w-[44ch] text-base text-ink-2">
                Su camino en el tenis de mesa comienza aquí.
              </p>
              <p className="max-w-[44ch] text-sm text-ink-2">
                <b className="font-semibold text-ink">{props.studentName}</b>{" "}
                ha sido registrado como estudiante de Cata Club.{" "}
                {props.isSelf
                  ? "Usted es el titular de la cuenta y el estudiante."
                  : "Usted es el representante y responsable de pago de este estudiante."}
              </p>
            </div>

            {/* The session that never was (issue #717): on the card, not in a
                toast, because the remedy lives in a browser settings panel. */}
            {sessionNotice !== null && (
              <p
                role="alert"
                data-testid="enroll-session-not-confirmed"
                className="rounded-ctl border border-state-bad bg-canvas px-3.5 py-2.5 text-sm text-ink-2"
              >
                {sessionNotice}
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              {/* #717 / #1055: `/student` is protected. Without a confirmed
                  session the honest destination is /login. */}
              {accountAreaLink ? (
                <Link href={accountAreaLink.href} className={buttonClasses("primary")}>
                  {accountAreaLink.label}
                </Link>
              ) : (
                <Link href="/login" className={buttonClasses("primary")}>
                  Iniciar sesión
                </Link>
              )}
              <Button variant="secondary" onClick={props.onReset}>
                Nueva inscripción
              </Button>
            </div>
          </div>
        </div>
        </div>
      </section>

      <section aria-labelledby="enroll-next-steps">
        <h2
          id="enroll-next-steps"
          className="mb-section text-2xs font-bold uppercase text-ink-3"
        >
          Qué sigue
        </h2>
        <ol className="grid gap-section sm:grid-cols-2 lg:grid-cols-4">
          {nextSteps(sessionConfirmed).map((step, index) => (
            <li key={step.title} className="card flex flex-col gap-section p-page">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-coal font-display text-base tracking-flat text-ball"
              >
                {index + 1}
              </span>
              <h3 className="font-display text-base uppercase tracking-flat text-ink">{step.title}</h3>
              <p className="text-sm text-ink-2">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
