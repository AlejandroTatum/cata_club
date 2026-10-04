/**
 * The enrollment-confirmed screen: a moment of welcome, not a receipt.
 *
 *   · one coal hero over a real club photograph — the student's name carries
 *     the screen, the success state is a quiet line above it, the club's voice
 *     (the one Playfair phrase) sits under it, and the primary action is the
 *     only filled control; "Nueva inscripción" is an outline on coal; and
 *   · "Qué sigue" as a connected sequence: one rail runs through the four
 *     steps (left to right on desktop, top to bottom on a phone), the first
 *     already done. No cards, so no step is a box with an empty body.
 *
 * Every claim on it is the one the card carried before. The session half of the
 * first step is a CLAIM and is only made when `sessionConfirmed` (issue #717);
 * the delivery of the verification email is never promised (issue #1398).
 */
import type { ReactElement } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, CheckCircle } from "lucide-react";
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
      title: "Tu cuenta",
      body: sessionConfirmed
        ? "Tu cuenta ya está creada y la sesión, iniciada."
        : "Tu cuenta ya está creada. Inicia sesión con tu correo y tu contraseña.",
    },
    {
      title: "Tu correo",
      body: "Verifica tu correo: registramos el envío de un enlace de confirmación; puede tardar unos minutos en llegar. Si no llega, reenvíalo desde la pantalla de activación, donde también puedes corregir el correo.",
    },
    {
      title: "El club",
      body: "Acércate al club o escríbenos por WhatsApp para registrar la inscripción y el primer pago.",
    },
    {
      title: "Tu membresía",
      body: "El club lo valida y ahí se activa la membresía.",
    },
  ];
}

export default function EnrollConfirmation(props: EnrollConfirmationProps): ReactElement {
  const { sessionConfirmed, sessionNotice, accountAreaLink } = props;
  const steps = nextSteps(sessionConfirmed);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4">
      <section
        data-confirm-card
        className="relative isolate flex flex-col overflow-hidden rounded-card bg-coal text-white shadow-elevated lg:min-h-[28rem]"
      >
        {/* The photograph: a band above the text on a phone, the whole card
            behind it from `lg`, where a coal wash from the left keeps the text
            on a flat surface and lets the room show through on the right. */}
        <figure className="relative aspect-[16/9] w-full flex-none lg:absolute lg:inset-0 lg:-z-10 lg:aspect-auto">
          <Image
            src="/landing/hero-training.jpg"
            alt="Jugadores de Cata Club entrenando en las mesas del club"
            fill
            priority
            sizes="(min-width: 1152px) 1152px, 100vw"
            className="object-cover"
            style={{ objectPosition: "50% 40%" }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-coal via-coal/30 to-transparent lg:bg-gradient-to-r lg:from-coal lg:via-coal/90 lg:via-45% lg:to-coal/10"
          />
        </figure>

        <div className="flex flex-col justify-center gap-6 p-page pt-2 lg:max-w-[40rem] lg:flex-1 lg:p-14">
          <div className="flex flex-col gap-3">
            <h1 className="flex items-center gap-2 text-sm font-semibold text-white/80">
              <CheckCircle size={ICON.sm} className="text-ball" strokeWidth={1.75} aria-hidden="true" />
              Inscripción completada
            </h1>
            <p className="text-2xs font-bold uppercase text-ball">
              ¡Te damos la bienvenida a Cata Club!
            </p>
            <h2 className="font-display text-3xl uppercase tracking-flat text-white [text-wrap:balance] lg:text-5xl">
              {props.studentName}
            </h2>
          </div>

          {/* #877: a contained emotional line, not a second claim — it says
              nothing about membership, payment or session. The one Playfair
              phrase on the screen. */}
          <p className="max-w-[28ch] font-serif text-voice text-white [text-wrap:balance]">
            Tu camino en el tenis de mesa comienza aquí.
          </p>

          <p className="max-w-[48ch] text-sm text-[#B9B9C1]">
            {props.isSelf
              ? "Has sido registrado como jugador de Cata Club. Eres el titular de la cuenta y el jugador."
              : "Has sido registrado como jugador de Cata Club. Eres el representante y responsable de pago de este jugador."}
          </p>

          {/* The session that never was (issue #717): on the card, not in a
              toast, because the remedy lives in a browser settings panel. A
              quiet note — a ball rule and plain text — not a boxed alert. */}
          {sessionNotice !== null && (
            <p
              role="alert"
              data-testid="enroll-session-not-confirmed"
              className="max-w-[56ch] border-l-2 border-ball pl-3.5 text-sm text-[#B9B9C1]"
            >
              {sessionNotice}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
            <Button variant="onCoal" onClick={props.onReset}>
              Nueva inscripción
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="enroll-next-steps">
        <h2
          id="enroll-next-steps"
          className="mb-page font-display text-lg uppercase tracking-flat text-ink"
        >
          Qué sigue
        </h2>
        {/* One rail through the four steps. Desktop: a hairline at marker height
            runs under the row; phone: the same line runs down the marker column. */}
        <ol className="grid gap-6 lg:grid-cols-4 lg:gap-8">
          {steps.map((step, index) => {
            const done = index === 0;
            return (
              <li
                key={step.title}
                className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 lg:block"
              >
                {index < steps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-4 top-8 -bottom-6 w-px bg-line-2 lg:-bottom-auto lg:left-8 lg:right-[-2rem] lg:top-4 lg:h-px lg:w-auto"
                  />
                )}
                <span
                  aria-hidden="true"
                  className={
                    done
                      ? "relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-coal text-ball"
                      : "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border border-line-2 bg-canvas font-display text-base tracking-flat text-ink-2"
                  }
                >
                  {done ? <Check size={ICON.sm} strokeWidth={2.25} /> : index + 1}
                </span>
                <div className="min-w-0 lg:mt-4">
                  <h3 className="text-base font-semibold text-ink">{step.title}</h3>
                  <p className="mt-1 text-sm text-ink-2">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
