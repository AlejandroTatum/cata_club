/**
 * The contextual aside beside the step form (from `lg`): a recessed panel that
 * answers the question the current step raises — what it costs, why a datum is
 * asked, what the club does with health data, what happens after confirming.
 *
 * Every sentence reuses copy that already lives in the wizard (field hints,
 * the confirmation paragraph, the sensitive-data notice); nothing here states a
 * policy the flow does not already state. Below `lg` the aside only survives
 * where it carries something the visitor must see in the flow itself — the
 * tariffs on step 1 — and the rest is hidden.
 *
 * The items are direct children of one column that spreads them over the
 * surface's height, so the panel reads as a full-height rail rather than a
 * short list with a void under it.
 */

import type { ReactElement, ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/components/ui/cn";

export type EnrollAsideStep =
  "type" | "personal" | "representative" | "health" | "summary";

export type EnrollAsideDocument = "terminos" | "privacidad";

interface EnrollAsideProps {
  step: EnrollAsideStep;
  isChild: boolean;
  /** Step 1: the public tariff tiles, already rendered by the page. */
  tariffs: ReactNode;
  onOpenDocument: (doc: EnrollAsideDocument) => void;
}

/** One titled item of the rail. `heading` labels the group the item opens. */
function Item(props: {
  heading?: string;
  title: string;
  children: ReactNode;
  number?: number;
  className?: string;
}): ReactElement {
  return (
    <div className={props.className}>
      {props.heading && (
        <h3 className="mb-page text-xs font-bold uppercase tracking-flat text-ink-3-strong">
          {props.heading}
        </h3>
      )}
      <div className="flex gap-3">
        {props.number !== undefined && (
          <span
            aria-hidden="true"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-coal text-sm font-bold text-white"
          >
            {props.number}
          </span>
        )}
        <div>
          <p className="text-base font-semibold text-ink">{props.title}</p>
          <div className="mt-1 text-sm text-ink-2">{props.children}</div>
        </div>
      </div>
    </div>
  );
}

function PrivacyLink(props: { onOpen: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={props.onOpen}
      className="self-start text-sm font-semibold text-ink underline"
    >
      Leer el aviso de privacidad
    </button>
  );
}

function AfterConfirming(props: { heading: string }): ReactElement {
  return (
    <>
      <Item heading={props.heading} number={1} title="Verifica tu correo">
        Se solicita un correo de verificación a la dirección que indicaste.
      </Item>
      <Item number={2} title="Acércate al club o escríbenos">
        Por WhatsApp o en persona, para registrar la inscripción y el primer
        pago.
      </Item>
      <Item number={3} title="El club lo valida">
        El club valida la inscripción y el primer pago; ahí se activa la
        membresía.
      </Item>
    </>
  );
}

/**
 * Fills whatever height the items leave free. It is a photograph, not spacing:
 * below its minimum height it simply is not rendered, so a step whose items
 * already fill the rail never squeezes it into a sliver.
 */
function ClubPhoto(): ReactElement {
  return (
    <figure className="relative hidden min-h-40 flex-1 overflow-hidden rounded-ctl bg-coal lg:block">
      <Image
        src="/landing/hero-training.jpg"
        alt="Deportistas de Cata Club entrenando tenis de mesa en el club"
        fill
        sizes="(min-width: 1536px) 450px, 258px"
        className="object-cover"
        style={{ objectPosition: "72% 62%" }}
      />
      <figcaption className="absolute inset-x-0 bottom-0 bg-coal/70 px-4 py-2 text-sm font-semibold text-white">
        Entrenamiento en el club
      </figcaption>
    </figure>
  );
}

export default function EnrollAside(props: EnrollAsideProps): ReactElement {
  const { step } = props;
  return (
    <aside
      data-enroll-aside
      aria-label="Información del paso"
      className={cn(
        "flex-col gap-page rounded-card bg-sunken p-page lg:col-span-2 lg:flex lg:p-10",
        step === "type" ? "flex" : "hidden",
      )}
    >
      {step === "type" && (
        <>
          {props.tariffs}
          <div className="hidden lg:contents">
            <AfterConfirming heading="Cómo sigue" />
          </div>
        </>
      )}

      {step === "personal" && (
        <>
          <Item heading="Por qué pedimos estos datos" title="Cédula">
            Identifica al jugador; son 10 dígitos, sin guiones.
          </Item>
          <Item title="Fecha de nacimiento">
            {props.isChild
              ? "Con ella calculamos la edad del jugador: día, mes y año de cuatro dígitos."
              : "Con ella calculamos tu edad: un menor de edad requiere un representante."}
          </Item>
          {props.isChild ? (
            <Item title="Tu cuenta">
              Los datos del jugador se registran por separado de la cuenta de
              acceso del representante, que se pide en el paso siguiente.
            </Item>
          ) : (
            <>
              <Item title="Teléfono">
                Es el número al que el club puede contactarte.
              </Item>
              <Item title="Correo electrónico">
                Es la dirección a la que se solicita el correo de verificación
                de la cuenta.
              </Item>
              <Item title="Tu contraseña">
                Usa al menos 8 caracteres y evita las contraseñas más usadas.
                Para que sea segura, alárgala o mezcla mayúsculas, números y
                símbolos.
              </Item>
            </>
          )}
          <Item title="Tus datos">
            Se manejan de forma segura conforme a la normativa de protección de
            datos.
          </Item>
          <PrivacyLink onOpen={() => props.onOpenDocument("privacidad")} />
        </>
      )}

      {step === "representative" && (
        <>
          <Item heading="Tu papel como representante" title="Responsable legal">
            Al inscribir a un jugador, confirmas ser su responsable legal.
          </Item>
          <Item title="Responsable de pago">
            Serás el responsable de pago de este jugador.
          </Item>
          <Item title="Contacto del club">
            En caso de emergencia, el club te contactará con el nombre y
            teléfono de representante que ya indicaste.
          </Item>
          <Item title="Tu cuenta">
            Los datos del jugador se registran por separado de tu cuenta de
            acceso.
          </Item>
          <Item title="Mayoría de edad">
            El representante debe ser mayor de edad. Tu correo recibe la
            verificación de la cuenta.
          </Item>
          <PrivacyLink onOpen={() => props.onOpenDocument("privacidad")} />
        </>
      )}

      {step === "health" && (
        <>
          <Item heading="Antes de continuar" title="Datos sensibles">
            Esta información se maneja de forma segura conforme a la normativa
            de protección de datos.
          </Item>
          <Item title="Contacto de emergencia">
            {props.isChild
              ? "En caso de emergencia, el club te contactará con el nombre y teléfono de representante que ya indicaste."
              : "Indica el nombre y el teléfono de la persona a la que el club debe llamar. El teléfono de emergencia debe ser diferente del teléfono del jugador."}
          </Item>
          <Item title="Para qué sirve">
            Es información que el club necesita conocer para la seguridad del
            jugador.
          </Item>
          <Item title="Alergias y condiciones de salud">
            Son obligatorias. Si no tiene, escribe «Ninguno».
          </Item>
          <PrivacyLink onOpen={() => props.onOpenDocument("privacidad")} />
        </>
      )}

      {step === "summary" && (
        <>
          <AfterConfirming heading="Qué pasa después" />
          <Item heading="Antes de confirmar" title="Revisa cada bloque">
            Corrige cualquier bloque antes de confirmar con tu botón Editar.
          </Item>
          <Item title="Tu consentimiento">
            Para confirmar, acepta los Términos y condiciones.
          </Item>
        </>
      )}
      <ClubPhoto />
    </aside>
  );
}
