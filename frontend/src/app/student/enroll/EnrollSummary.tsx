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
import { formatAgeYears } from "@/components/wizard-fields";
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
  /** Restyled for the coal brand panel of the wide frame. */
  dark?: boolean;
  children?: ReactNode;
}

const ROW = "flex items-baseline justify-between gap-section py-field";

/** One aligned key–value row; an empty value keeps its slot as "Pendiente". */
function Fact(props: { label: string; value: string; dark?: boolean }): ReactElement {
  return (
    <div className={ROW}>
      <dt className={cn("flex-none text-xs", props.dark ? "text-white/75" : "text-ink-3-strong")}>
        {props.label}
      </dt>
      <dd
        title={props.value || undefined}
        className={cn(
          "text-right text-sm",
          props.value
            ? "min-w-0 truncate font-semibold tabular-nums"
            : props.dark
              ? "text-white/75"
              : "text-ink-3-strong",
          props.value && (props.dark ? "text-white" : "text-ink"),
        )}
      >
        {props.value || "Pendiente"}
      </dd>
    </div>
  );
}

export function SummaryRow(props: {
  label: string;
  dark?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <li className={ROW}>
      <span className={cn("text-sm", props.dark ? "text-white/90" : "text-ink-2")}>
        {props.label}
      </span>
      <b className={cn("text-sm tabular-nums", props.dark ? "text-white" : "text-ink")}>
        {props.children}
      </b>
    </li>
  );
}

export default function EnrollSummary({
  formData,
  steps,
  currentStep,
  dark = false,
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
      className={cn(
        dark ? "rounded-card border border-white/10 bg-coal-2 p-section" : "card p-section",
        !children && "hidden lg:block",
      )}
    >
      {/* On a phone only the trailing section (tariffs) shows; the mirror of
          the form is redundant next to the form itself. */}
      <div className="hidden lg:block">
        <h2
          className={cn("mb-section text-base font-semibold", dark ? "text-white" : "text-ink")}
        >
          Resumen
        </h2>

        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-semibold",
              dark ? "bg-white/10 text-white" : "bg-sunken text-ink-2",
            )}
          >
            {name ? getUserInitials(name) : "?"}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p
                title={name || undefined}
                className={cn(
                  "truncate text-sm",
                  name ? "font-semibold" : "",
                  name ? (dark ? "text-white" : "text-ink") : dark ? "text-white/75" : "text-ink-3-strong",
                )}
              >
                {name || (isChild ? "Nuevo representante" : "Nuevo jugador")}
              </p>
              {dark ? (
                <span className="flex-none rounded-full bg-white/10 px-2 py-0.5 text-2xs font-semibold text-white">
                  {isChild ? "Representante" : "Jugador"}
                </span>
              ) : (
                <Badge className="flex-none">
                  {isChild ? "Representante" : "Jugador"}
                </Badge>
              )}
            </div>
            <p className={cn("text-xs", dark ? "text-white/75" : "text-ink-3-strong")}>
              {agePlausible ? (
                <>
                  {formatAgeYears(age)}
                  {age < 18 && (
                    <span className={dark ? "text-ball" : "text-state-warn"}> · menor de edad</span>
                  )}
                </>
              ) : (
                "Edad por completar"
              )}
            </p>
          </div>
        </div>

        <dl
          className={cn(
            "mt-section divide-y border-t",
            dark ? "divide-white/10 border-white/10" : "divide-line border-line",
          )}
        >
          <Fact dark={dark} label="Cédula" value={formData.cedula} />
          {isChild ? (
            <Fact dark={dark} label="Representante" value={guardian} />
          ) : (
            <Fact
              dark={dark}
              label="Teléfono"
              value={formData.telefono ? toStoredPhone(formData.telefono) : ""}
            />
          )}
          <Fact dark={dark} label="Correo" value={email} />
        </dl>

        <div className={cn("mt-section border-t pt-section", dark ? "border-white/10" : "border-line")}>
          <div
            className={cn(
              "mb-field flex items-baseline justify-between text-xs",
              dark ? "text-white/75" : "text-ink-3-strong",
            )}
          >
            <span>{`${stepNumber} de ${steps.length} pasos`}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Progreso de la inscripción"
            aria-valuemin={1}
            aria-valuenow={stepNumber}
            aria-valuemax={steps.length}
            className={cn("h-1.5 overflow-hidden rounded-full", dark ? "bg-white/10" : "bg-sunken")}
          >
            <div
              className={cn("h-full rounded-full", dark ? "bg-ball" : "bg-coal")}
              style={{ width: `${(stepNumber / steps.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {children && (
        <div
          className={cn(
            "lg:mt-section lg:border-t lg:pt-section",
            dark ? "lg:border-white/10" : "lg:border-line",
          )}
        >
          {children}
        </div>
      )}
    </aside>
  );
}
