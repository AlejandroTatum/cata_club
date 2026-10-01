"use client";

/** Compact "how to pay" help for the /student/payments rail. */

import ContextualHelp from "@/components/ContextualHelp";
import { formatCurrency } from "@/lib/format-utils";
import { describePaymentSituation } from "../student-utils";
import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// "Cómo se registra un pago" — the procedure, behind "Ver ayuda"
//
// The complaint this answers is literal: "hasta ahora ni yo sé cómo probar ese
// flujo porque nunca se muestra". The upload has always existed — it is the
// file input the form reveals for a TRANSFERENCIA — but nothing on the screen
// said the form existed, what it would ask for, or that the comprobante is
// what the club validates. A reader who could pay saw one button; a reader who
// could NOT pay (a minor on their own account) saw a sentence that ended the
// conversation. Every step describes something on THIS screen or something the
// club demonstrably does — an ADMINISTRADOR can register a payment for a
// persona (`membresia_pago_servicio.registrar_pago` authorizes owner,
// representative or admin, and `/members` is where the club does it).
//
// ## Why it stopped being a rail (D11c, and D11b)
//
// It was a permanent card in the second column, and it was wrong on both
// counts the redesign names.
//
// D11c: the page subtitle says WHAT this screen is in one line; everything
// that explains HOW it works goes behind "Ver ayuda". This was three numbered
// steps and a preamble — a procedure, top to bottom, and the longest piece of
// loose help in the family portal.
//
// D11b: it was also the layout defect. Its height is FIXED — the same three
// steps whether the family has forty payments or none — so in the thin state
// it was the tallest item on the screen and its height became the grid row's.
// The comment it used to carry admitted the symptom ("dejaba un hueco de
// 170px") and answered it with `row-span-2`, which spread the same fixed block
// over both rows instead of removing the thing that was setting the height.
// Behind a disclosure it costs one 20px line closed, and the block that grows
// with the family's real record — the history — is free to claim the page.
// ---------------------------------------------------------------------------

export function HowToPay({
  /** `null` when the reader is the student — "usted" instead of a name. */
  studentName,
  /** The minor-on-their-own-account case: the rail carries the alternative, not the steps. */
  blocked,
  /**
   * Issue #400 (slice 4c-b): the gratuitous case — `RenewPaymentForm` is
   * replaced by an explanatory paragraph (see the render below), so the
   * month-selector procedure below ("elija cuántos meses… cada mes cuesta
   * $X") describes a form that is not there for this reader.
   */
  gratuitous,
  /** True once the club has a `Membresia` to renew; without one the form cannot be reached at all. */
  hasMembership,
  monthlyPrice,
  /**
   * Open the procedure on mount — true only for the two states whose next step
   * IS this procedure (see the caller). The `gratuitous` and `blocked`
   * variants ignore it: those describe a situation rather than a procedure,
   * and neither state can co-occur with `expired`/`never-paid`.
   */
  openByDefault,
}: {
  studentName: string | null;
  blocked: boolean;
  gratuitous: boolean;
  hasMembership: boolean;
  monthlyPrice: string | null;
  openByDefault: boolean;
}): React.ReactElement {
  const subject = studentName ? `de ${studentName}` : "suyo";

  if (gratuitous) {
    return (
      <ContextualHelp title="Cómo funciona esta membresía">
        <p>
          El club le otorgó gratuidad familiar: esta membresía no genera ningún cobro y no hay
          ningún monto que registrar acá.
        </p>
        <p className="mt-2.5">
          Para extender la cobertura cuando corresponda, el club se encarga de registrarlo. Si
          necesita algo puntual, acérquese a administración.
        </p>
      </ContextualHelp>
    );
  }

  if (blocked) {
    return (
      <ContextualHelp title="Cómo se paga esta membresía">
        {/* The card above already names WHO registers the payment, from
            `describePaymentSituation`. Repeating that sentence here printed it
            twice on one screen; this answers the next question instead — what
            the reader actually does. */}
        <p>Su cuenta no registra pagos, pero el pago sí se puede hacer. Estos son los pasos:</p>
        <ol className="mt-2.5 flex flex-col gap-2.5">
          <HowToPayStep index={1}>
            Acérquese a administración del club con el valor del plan
            {monthlyPrice ? ` (${formatCurrency(monthlyPrice)} al mes)` : ""}. También puede pagar
            por transferencia y entregar el comprobante allí.
          </HowToPayStep>
          <HowToPayStep index={2}>
            El club registra el pago a su nombre y elige el período que cubre.
          </HowToPayStep>
          <HowToPayStep index={3}>
            El pago aparece en el historial de esta misma pantalla, con el período cubierto y su
            estado.
          </HowToPayStep>
        </ol>
      </ContextualHelp>
    );
  }

  if (!hasMembership) {
    return (
      <ContextualHelp title="Cómo se registra un pago" defaultOpen={openByDefault}>
        <p>
          El club crea la membresía al registrar el primer pago, así que ese primero se hace en
          administración. Desde el segundo, la renovación se registra aquí: monto, forma de pago y
          —si es transferencia— el comprobante.
        </p>
      </ContextualHelp>
    );
  }

  return (
    <ContextualHelp title="Cómo se registra un pago" defaultOpen={openByDefault}>
      <p>Son tres pasos y terminan en el club, no en usted: lo último lo hace quien valida.</p>
      <ol className="mt-2.5 flex flex-col gap-2.5">
        <HowToPayStep index={1}>
          Abra <b className="font-semibold text-ink">Registrar un pago</b> y elija cuántos meses{" "}
          {subject === "suyo" ? "" : `${subject} `}va a pagar, más la forma de pago — nunca escribe
          un monto.
          {monthlyPrice ? (
            <>
              {" "}
              Cada mes cuesta {formatCurrency(monthlyPrice)}: el formulario muestra el período y el
              total estimado antes de que confirme.
            </>
          ) : null}
        </HowToPayStep>
        <HowToPayStep index={2}>
          Si paga por <b className="font-semibold text-ink">transferencia</b>, adjunte el
          comprobante — PDF, JPG o PNG, hasta 5 MB. Sin comprobante el club no tiene qué validar, y
          el formulario no deja continuar.
        </HowToPayStep>
        <HowToPayStep index={3}>
          El pago queda <b className="font-semibold text-ink">en revisión</b> en el historial hasta
          que el club lo apruebe o lo rechace. Si lo rechaza, el motivo aparece en la misma fila.
        </HowToPayStep>
      </ol>
    </ContextualHelp>
  );
}

/**
 * One step of the procedure.
 *
 * Numbered because the order is the information — this is the only numbered
 * sequence in the product, and it is one because doing step 2 before step 1 is
 * not possible.
 *
 * The disc keeps its coal fill and its tabular figure; what it lost with the
 * card is the row chrome (the 20px gutter and the hairline between steps),
 * which belonged to a panel and reads as a table inside the help sheet.
 */
function HowToPayStep({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="mt-px flex h-[20px] w-[20px] flex-none items-center justify-center rounded-full bg-coal text-2xs tracking-flat font-bold tabular-nums text-white"
      >
        {index}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}
