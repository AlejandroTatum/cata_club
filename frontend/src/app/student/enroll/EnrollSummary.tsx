/**
 * "Resumen" — the live rail beside the form.
 *
 * It only mirrors what the visitor has typed so far (type, name, age, cédula,
 * contact) and how far along the wizard is; it never validates and never
 * gates anything. An empty datum reads "Pendiente" rather than disappearing,
 * so every row keeps its height from the first keystroke. The step names live
 * in the stepper above the form, so the rail only reports the count.
 *
 * `children` is an optional trailing section (the public tariffs on step 1)
 * that shares the card, under a hairline, in the same key–value idiom.
 */

import type { ReactElement, ReactNode } from "react";
import { getUserInitials } from "@/lib/auth-utils";
import {
  calculatePersonAge,
  isPlausibleHumanAge,
  toStoredPhone,
} from "@/lib/identity-validation";
import Badge from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import {
  ENROLLMENT_TYPES,
  type EnrollFormData,
  type WizardStep,
} from "./enroll-utils";

interface EnrollSummaryProps {
  formData: EnrollFormData;
  steps: WizardStep[];
  currentStep: WizardStep;
  children?: ReactNode;
}

const ROW = "flex items-baseline justify-between gap-section py-field";

/** One aligned key–value row; an empty value keeps its slot as "Pendiente". */
function Fact(props: { label: string; value: string }): ReactElement {
  return (
    <div className={ROW}>
      <dt className="flex-none text-xs text-ink-3-strong">{props.label}</dt>
      <dd
        title={props.value || undefined}
        className={
          props.value
            ? "min-w-0 truncate text-right text-sm font-semibold tabular-nums text-ink"
            : "text-right text-sm text-ink-3-strong"
        }
      >
        {props.value || "Pendiente"}
      </dd>
    </div>
  );
}

export function SummaryRow(props: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <li className={ROW}>
      <span className="text-sm text-ink-2">{props.label}</span>
      <b className="text-sm tabular-nums text-ink">{props.children}</b>
    </li>
  );
}

export default function EnrollSummary({
  formData,
  steps,
  currentStep,
  children,
}: EnrollSummaryProps): ReactElement {
  const isChild = formData.enrollmentType === ENROLLMENT_TYPES.CHILD;
  const name = `${formData.nombres} ${formData.apellidos}`.trim();
  const age = formData.fechaNacimiento
    ? calculatePersonAge(formData.fechaNacimiento)
    : NaN;
  const agePlausible = !Number.isNaN(age) && isPlausibleHumanAge(age);
  const stepNumber = steps.indexOf(currentStep) + 1;

  const guardian =
    `${formData.nombreRepresentante} ${formData.apellidosRepresentante}`.trim();
  const email = isChild ? formData.correoRepresentante : formData.correo;

  return (
    <aside
      aria-label="Resumen de la inscripción"
      className={cn("card p-section", !children && "hidden lg:block")}
    >
      {/* On a phone only the trailing section (tariffs) shows; the mirror of
          the form is redundant next to the form itself. */}
      <div className="hidden lg:block">
        <h2 className="mb-section text-base font-semibold text-ink">Resumen</h2>

        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-sunken text-sm font-semibold text-ink-2"
          >
            {name ? getUserInitials(name) : "?"}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p
                title={name || undefined}
                className={
                  name
                    ? "truncate text-sm font-semibold text-ink"
                    : "truncate text-sm text-ink-3-strong"
                }
              >
                {name || (isChild ? "Nuevo representante" : "Nuevo jugador")}
              </p>
              <Badge className="flex-none">
                {isChild ? "Representante" : "Jugador"}
              </Badge>
            </div>
            <p className="text-xs text-ink-3-strong">
              {agePlausible ? (
                <>
                  {age} años
                  {age < 18 && (
                    <span className="text-state-warn"> · menor de edad</span>
                  )}
                </>
              ) : (
                "Edad por completar"
              )}
            </p>
          </div>
        </div>

        <dl className="mt-section divide-y divide-line border-t border-line">
          <Fact label="Cédula" value={formData.cedula} />
          {isChild ? (
            <Fact label="Representante" value={guardian} />
          ) : (
            <Fact
              label="Teléfono"
              value={formData.telefono ? toStoredPhone(formData.telefono) : ""}
            />
          )}
          <Fact label="Correo" value={email} />
        </dl>

        <div className="mt-section border-t border-line pt-section">
          <div className="mb-field flex items-baseline justify-between text-xs text-ink-3-strong">
            <span>{`${stepNumber} de ${steps.length} pasos`}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Progreso de la inscripción"
            aria-valuemin={1}
            aria-valuenow={stepNumber}
            aria-valuemax={steps.length}
            className="h-1.5 overflow-hidden rounded-full bg-sunken"
          >
            <div
              className="h-full rounded-full bg-coal"
              style={{ width: `${(stepNumber / steps.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {children && (
        <div className="lg:mt-section lg:border-t lg:border-line lg:pt-section">
          {children}
        </div>
      )}
    </aside>
  );
}
