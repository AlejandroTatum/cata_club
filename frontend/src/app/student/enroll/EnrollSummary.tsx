/**
 * "Resumen de la inscripción" — the live rail beside the form.
 *
 * It only mirrors what the visitor has typed so far (type, name, age, cédula,
 * contact) plus the step checklist; it never validates and never gates
 * anything. An empty datum reads "—" rather than disappearing, so the rail
 * keeps one shape from the first keystroke.
 */

import type { ReactElement } from "react";
import { Check } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { calculatePersonAge, isPlausibleHumanAge, toStoredPhone } from "@/lib/identity-validation";
import { cn } from "@/components/ui/cn";
import {
  ENROLLMENT_TYPES,
  STEP_SHORT_LABELS,
  type EnrollFormData,
  type WizardStep,
} from "./enroll-utils";

interface EnrollSummaryProps {
  formData: EnrollFormData;
  steps: WizardStep[];
  currentStep: WizardStep;
}

function Datum(props: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div>
      <dt className="text-2xs font-bold uppercase text-ink-3-strong">{props.label}</dt>
      <dd className="mt-1 text-sm font-semibold text-ink">{props.children}</dd>
    </div>
  );
}

export default function EnrollSummary({ formData, steps, currentStep }: EnrollSummaryProps): ReactElement {
  const isChild = formData.enrollmentType === ENROLLMENT_TYPES.CHILD;
  const name = `${formData.nombres} ${formData.apellidos}`.trim();
  const age = formData.fechaNacimiento ? calculatePersonAge(formData.fechaNacimiento) : NaN;
  const agePlausible = !Number.isNaN(age) && isPlausibleHumanAge(age);
  const currentIndex = steps.indexOf(currentStep);

  const contact = isChild
    ? [
        `${formData.nombreRepresentante} ${formData.apellidosRepresentante}`.trim(),
        formData.correoRepresentante,
      ]
    : [formData.correo, formData.telefono ? toStoredPhone(formData.telefono) : ""];
  const contactText = contact.filter(Boolean).join(" · ");

  return (
    <aside aria-label="Resumen de la inscripción" className="card hidden p-page lg:block">
      <h2 className="mb-page font-display text-lg uppercase tracking-flat text-ink">
        Resumen de la inscripción
      </h2>

      <dl className="space-y-section">
        <Datum label="Tipo">{isChild ? "Representante" : "Jugador"}</Datum>
        <Datum label="Estudiante">{name || "—"}</Datum>
        <Datum label="Edad">
          {agePlausible ? (
            <>
              {age} años
              {age < 18 && <span className="ml-1 font-normal text-state-warn">· menor de edad</span>}
            </>
          ) : (
            "—"
          )}
        </Datum>
        <Datum label="Cédula">{formData.cedula || "—"}</Datum>
        <Datum label={isChild ? "Representante" : "Contacto"}>{contactText || "—"}</Datum>
      </dl>

      <ol aria-label="Pasos" className="mt-page space-y-field border-t border-line pt-page">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li
              key={step}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 text-sm",
                active ? "font-semibold text-ink" : done ? "text-state-ok" : "text-ink-3-strong",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 flex-none items-center justify-center rounded-full border",
                  done && "border-state-ok/30 bg-state-ok-bg",
                  active && "border-coal bg-ball",
                  !done && !active && "border-line-2 bg-sunken",
                )}
              >
                {done && <Check size={ICON.sm} strokeWidth={3} />}
              </span>
              {STEP_SHORT_LABELS[step]}
              {done && <span className="sr-only"> (completado)</span>}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
