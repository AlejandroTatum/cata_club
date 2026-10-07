"use client";

import { useState } from "react";
import BeneficioSection from "./BeneficioSection";
import PaymentHistorySection from "./PaymentHistorySection";
import CreateMembershipForm from "./CreateMembershipForm";
import RegisterPaymentForm from "./RegisterPaymentForm";
import RegularizarDeudaForm from "./RegularizarDeudaForm";
import SuspenderReactivarForm from "./SuspenderReactivarForm";
import CambiarPlanForm from "./CambiarPlanForm";
import MigrarSocioAntiguoForm from "./MigrarSocioAntiguoForm";
import PagoPendienteRevision from "./PagoPendienteRevision";
import { Badge, Button } from "@/components/ui";
import type { PagoPersona } from "@/services/api";
import { formatCurrency } from "@/lib/format-utils";
import { tarifaFactLabel } from "@/lib/tarifa-periodo";
import {
  describePaymentsState,
  formatMembershipCoverage,
  isPrimerPagoPendiente,
  type MemberStudentSummary,
  type PaymentsState,
} from "./members-utils";

/**
 * The head of a student's Pagos page: who, ONE state chip, and one plain
 * sentence saying what is going on and what to do. Plan, monthly fee and
 * coverage end sit below as compact facts. Everything is read from the row's
 * own data (no extra fetch), so it is correct the moment the page opens.
 */
function PagosHeader({
  student,
  state,
}: {
  student: MemberStudentSummary;
  state: PaymentsState;
}): React.ReactElement {
  const { membresia } = student;
  const coverage = formatMembershipCoverage(membresia?.cubiertoHasta);
  const facts = membresia
    ? [
        ["Plan", membresia.tipo],
        [tarifaFactLabel(membresia.periodicidad), membresia.esGratuidadFamiliar ? "Gratuidad familiar" : formatCurrency(membresia.monto)],
        ...(coverage ? [["Cobertura", coverage.replace(/^Hasta/, "hasta")]] : []),
      ]
    : [];
  return (
    <header className="grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
          {student.nombres} {student.apellidos}
        </h2>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <p className="text-sm text-ink-2">{state.detail}</p>
      {facts.length > 0 && (
        <dl aria-label="Resumen de la membresía" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="flex gap-1.5">
              <dt className="text-ink-3-strong">{label}:</dt>
              <dd className="font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

/** One action: a line saying what it does, then its trigger/form. */
function ActionTile({
  description,
  children,
  ...dataAttrs
}: {
  description: string;
  children: React.ReactNode;
  "data-primary-action"?: string;
  "data-secondary-action"?: string;
}): React.ReactElement {
  return (
    <div {...dataAttrs} className="grid gap-2">
      <p className="text-sm text-ink-2">{description}</p>
      {children}
    </div>
  );
}

/** A block of the page: a heading and what it holds. */
function Block({
  title,
  children,
  tone = "primary",
  ...dataAttrs
}: {
  title: string;
  children: React.ReactNode;
  tone?: "primary" | "plain";
  "aria-label"?: string;
  "data-primary-action"?: string;
}): React.ReactElement {
  return (
    <section
      {...dataAttrs}
      className={`grid content-start gap-3 rounded-ctl border p-4 ${
        tone === "primary" ? "border-line-2 bg-paper shadow-soft" : "border-line bg-paper"
      }`}
    >
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {children}
    </section>
  );
}

/** One sentence each: what the choice means and when to use it. */
const TIPO_SOCIO_OPCIONES = {
  nuevo: { titulo: "Socio nuevo", detalle: "Es su primer mes en el club." },
  antiguo: { titulo: "Socio antiguo", detalle: "Ya pagaba antes de usar el sistema." },
} as const;

const ACTION_DESCRIPTION = {
  "registrar-pago": "Efectivo o transferencia, por período.",
  "regularizar-deuda":
    "Para meses vencidos que no figuran pagados, por ejemplo los pagados antes de usar el sistema.",
  reactivar: "Vuelve a activar la membresía.",
  "revisar-pago": "Revisa el pago y apruébalo o recházalo.",
} as const;

/**
 * The three refetch callbacks shared by every membership/payment write flow
 * for a student (Sonar duplication follow-up, issue #400): membership
 * creation, debt regularization, and suspend/reactivate/cambiar-plan each own
 * a named contract rather than collapsing into one generic "onChanged", and
 * every one of them currently resolves to the same `loadMembers` call at the
 * page level.
 *
 * Lives here (not in `page.tsx`) so the members page and the per-member
 * payments page (`/members/[id]/pagos`, #1668) depend on the same contract
 * without either importing the other's page module.
 */
export interface MembresiaCallbacks {
  /** Called after a membership is successfully created so the page can
   *  refetch and show the new row. */
  onMembershipCreated: () => void;
  /** Called after a debt regularization is recorded (issue #284) so the
   *  page can refetch and show the remaining debt. */
  onDebtRegularized: () => void;
  /** Called after a suspend/reactivate/cambiar-plan write (issue #400,
   *  criterios 1/3). */
  onMembresiaChanged: () => void;
  /** Called after a payment is registered (issue #1199) so the page can
   *  refetch and show it, instead of asking the admin to reload manually. */
  onPaymentRegistered: () => void;
}

interface StudentMembershipActionsProps extends MembresiaCallbacks {
  personaId: number;
  student: MemberStudentSummary;
}

/**
 * The membership/payment write flows for one student — club benefit, create
 * a membership, register a payment, register overdue months, suspend/
 * reactivate, change plan. Rendered by the per-member payments page (#1668),
 * which replaced the Pagos dialog (#505) without forking any of these flows.
 *
 * Which write flow is offered is decided here, and only here: a membership
 * is created when there is none, and a payment is registered against one
 * that exists. What the page LEADS with is `describePaymentsState`: one plain
 * state and one primary action; everything else is secondary.
 */
export default function StudentMembershipActions({
  personaId,
  student,
  onMembershipCreated,
  onDebtRegularized,
  onMembresiaChanged,
  onPaymentRegistered: onPaymentRegisteredProp,
}: StudentMembershipActionsProps): React.ReactElement {
  const membresia = student.membresia;
  // ADMA-04: the history fetches once on open, so a write has to ask for a refetch.
  const [historyVersion, setHistoryVersion] = useState(0);
  // QA round 2 (L17): before the first coverage the admin says whether this is a
  // new member (the usual first-payment flow) or an old one (load the last payment).
  const [tipoSocio, setTipoSocio] = useState<"nuevo" | "antiguo" | null>(null);
  const [resultadoMigracion, setResultadoMigracion] = useState<string | null>(null);
  // Loaded by the history; the page leads with the pending one and shows
  // «¿Algo está mal?» only when there is something to fix.
  const [pagos, setPagos] = useState<PagoPersona[] | null>(null);
  const [pagosFailed, setPagosFailed] = useState(false);
  // A registration and a correction both change the history AND the member's
  // standing (coverage, debt), so both refetch the two.
  const onPaymentRegistered = (): void => {
    setHistoryVersion((version) => version + 1);
    onPaymentRegisteredProp();
  };
  if (!student.activo) {
    return (
      <>
        <output className="text-xs text-ink-3">Inactivo/Archivado: historial disponible, acciones deshabilitadas.</output>
        <div className="mt-3">
          <PaymentHistorySection personaId={personaId} refreshKey={historyVersion} />
        </div>
      </>
    );
  }
  const preguntarTipoSocio = isPrimerPagoPendiente(student) && tipoSocio !== "nuevo";
  const debtKnown = membresia?.mesesAdeudados !== undefined;
  const hasDebt = debtKnown && (membresia?.mesesAdeudados ?? 0) > 0;
  /*
   * Issue #713: this is the BULK LOOKUP FAILED state, and nothing else.
   *
   * It used to be reached by ordinary, healthy data as well. `estado` here is
   * the frontend bucket, and `MEMBERSHIP_STATUS_BY_ESTADO` folds two backend
   * estados into it (VENCIDA and INACTIVA), but the BFF only ever fetched and
   * attached debt for VENCIDA — so every never-paid membership arrived as a
   * `"vencida"` with `mesesAdeudados` undefined and landed here permanently,
   * "self-healing" only when an approved payment flipped it to ACTIVA. On the
   * QA data that was 29 of the 45 rows shown as vencidas, every one of which
   * `GET /membresias/{id}/deuda` answers `200 {"mesesAdeudados":0}`.
   *
   * The guard was the defect, not this copy: `readsAsVencida` now decides
   * both the fetch (`api/members/route.ts`) and the attach
   * (`members-adapter.ts`), so reaching this line means the bulk call really
   * did fail and the message is true when it is shown.
   */
  const debtUnavailable = membresia?.estado === "vencida" && !debtKnown;
  const state = describePaymentsState(student);
  // «Socio nuevo» was picked: the first-payment step is now the membership /
  // payment form itself, so the primary action is the payment, not the choice.
  const primaryName = state.primaryAction === "tipo-socio" ? "registrar-pago" : state.primaryAction;
  // «Cargar pagos atrasados» only applies when months are owed (or the debt
  // could not be read, so it cannot be ruled out).
  const catchUpApplies = hasDebt || debtUnavailable;
  const regularizeDebt = membresia && (
    <RegularizarDeudaForm
      membresiaId={Number(membresia.id)}
      montoMensual={membresia.monto ?? 0}
      esGratuidadFamiliar={membresia.esGratuidadFamiliar}
      onRegularized={onDebtRegularized}
      primary={false}
    />
  );
  const registerPayment = membresia && (
    <RegisterPaymentForm
      personaId={personaId}
      membresia={membresia}
      onPaymentRegistered={onPaymentRegistered}
      primary
    />
  );
  // ADMA-17: a suspended membership rejects payments, so the way out leads.
  const suspended = membresia?.estado === "suspendida";
  const reactivar = membresia && (
    <SuspenderReactivarForm
      membresiaId={Number(membresia.id)}
      estado={membresia.estado}
      onChanged={onMembresiaChanged}
      primary
    />
  );
  const pendiente = pagos?.find((pago) => pago.estadoPago === "PENDIENTE_VALIDACION") ?? null;
  const tieneAprobados = pagos?.some((pago) => pago.estadoPago === "APROBADO") ?? false;
  const resolvePending = (): void => {
    setHistoryVersion((version) => version + 1);
    onPaymentRegisteredProp();
  };
  const cancelChoice = (
    <Button variant="secondary" size="sm" onClick={() => setTipoSocio(null)}>
      Cancelar
    </Button>
  );

  /** The ONE primary action of the page, for the state the member is in. */
  function nextStep(): React.ReactElement {
    if (preguntarTipoSocio && tipoSocio === null) {
      return (
        <Block title="Siguiente paso" data-primary-action="tipo-socio" aria-label="Siguiente paso">
          <p className="text-sm text-ink-2">Elige qué tipo de socio es para registrar su primer pago.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(TIPO_SOCIO_OPCIONES) as Array<keyof typeof TIPO_SOCIO_OPCIONES>).map((tipo) => (
              <button
                key={tipo}
                type="button"
                onClick={() => setTipoSocio(tipo)}
                className="grid gap-1 rounded-ctl border border-line-2 bg-paper p-4 text-left transition-colors hover:border-cata-red hover:bg-sunken"
              >
                <span className="text-base font-bold text-ink">{TIPO_SOCIO_OPCIONES[tipo].titulo}</span>
                <span className="text-sm text-ink-2">{TIPO_SOCIO_OPCIONES[tipo].detalle}</span>
              </button>
            ))}
          </div>
        </Block>
      );
    }
    if (preguntarTipoSocio && tipoSocio === "antiguo") {
      return (
        <Block title="Siguiente paso" data-primary-action="tipo-socio" aria-label="Siguiente paso">
          <p className="text-sm text-ink-2">
            <span className="font-semibold text-ink">Socio antiguo.</span> Anota su último pago; el sistema calcula
            hasta cuándo está al día.
          </p>
          <MigrarSocioAntiguoForm
            personaId={personaId}
            membresiaId={membresia ? Number(membresia.id) : undefined}
            onDone={(resultado) => {
              setResultadoMigracion(resultado);
              setTipoSocio(null);
              onMembershipCreated();
            }}
            onRefetch={onMembershipCreated}
            onBack={() => setTipoSocio(null)}
          />
        </Block>
      );
    }
    if (isPrimerPagoPendiente(student) && tipoSocio === "nuevo") {
      return (
        <Block title="Siguiente paso" data-primary-action="registrar-pago" aria-label="Siguiente paso">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-2">
              <span className="font-semibold text-ink">Socio nuevo · {membresia ? "Paso 2 de 2" : "Paso 1 de 2"}.</span>{" "}
              {membresia ? "Registra su primer pago." : "Asigna el plan para poder registrar su primer pago."}
            </p>
            {cancelChoice}
          </div>
          {membresia ? (
            <>
              {registerPayment}
              {hasDebt && regularizeDebt && (
                <ActionTile description={ACTION_DESCRIPTION["regularizar-deuda"]}>{regularizeDebt}</ActionTile>
              )}
            </>
          ) : (
            <CreateMembershipForm personaId={personaId} onCreated={onMembershipCreated} />
          )}
        </Block>
      );
    }
    if (!membresia) {
      return (
        <Block title="Siguiente paso" data-primary-action="crear-membresia" aria-label="Siguiente paso">
          <ActionTile description="Asigna un plan para poder registrar pagos.">
            <CreateMembershipForm personaId={personaId} onCreated={onMembershipCreated} />
          </ActionTile>
        </Block>
      );
    }
    if (primaryName === "revisar-pago") {
      return (
        <Block title="Siguiente paso" data-primary-action="revisar-pago" aria-label="Siguiente paso">
          <p className="text-sm text-ink-2">{ACTION_DESCRIPTION["revisar-pago"]}</p>
          {pendiente ? (
            <PagoPendienteRevision key={pendiente.id} pago={pendiente} onResolved={resolvePending} />
          ) : (
            <p className="text-sm text-ink-3" role="status">
              {pagos !== null
                ? "No se encontró el pago pendiente."
                : pagosFailed
                  ? "No se pudo cargar el pago pendiente. Recarga la página."
                  : "Cargando el pago…"}
            </p>
          )}
        </Block>
      );
    }
    return (
      <Block title="Siguiente paso" data-primary-action={primaryName} aria-label="Siguiente paso">
        {debtUnavailable && (
          <p className="text-xs text-ink-3" role="status">
            Estado de deuda no disponible; las acciones actuales siguen disponibles.
          </p>
        )}
        <ActionTile description={ACTION_DESCRIPTION[primaryName]}>
          {primaryName === "reactivar" ? reactivar : registerPayment}
        </ActionTile>
        {!suspended && catchUpApplies && regularizeDebt && (
          <div data-secondary-action="regularizar-deuda" className="grid gap-2 border-t border-line pt-3">
            <p className="text-sm text-ink-2">{ACTION_DESCRIPTION["regularizar-deuda"]}</p>
            {regularizeDebt}
          </div>
        )}
      </Block>
    );
  }

  return (
    <div className="grid gap-section">
      <PagosHeader student={student} state={state} />

      {resultadoMigracion && (
        <output className="rounded-ctl border border-line bg-sunken px-3 py-2 text-sm font-semibold text-ink">
          Socio antiguo registrado. {resultadoMigracion}.
        </output>
      )}

      {nextStep()}

      {pagos !== null && pagos.length > 0 && (
        <Block title="¿Algo está mal?" tone="plain" aria-label="¿Algo está mal?">
          <div className="grid gap-2 text-sm text-ink-2">
            {tieneAprobados && (
              <p>
                <span className="font-semibold text-ink">¿Registraste un monto equivocado o el mes equivocado?</span>{" "}
                Puedes corregir un pago aprobado: el monto, los meses y las fechas. Búscalo en el historial y usa
                «Corregir monto o meses».
              </p>
            )}
            {pendiente && (
              <p>
                <span className="font-semibold text-ink">¿El pago pendiente está mal?</span> Recházalo y vuelve a
                registrarlo.
              </p>
            )}
            {!tieneAprobados && !pendiente && (
              <p>Un pago rechazado no cuenta. Si hace falta, regístralo de nuevo con los datos correctos.</p>
            )}
          </div>
        </Block>
      )}

      {/* Issue #615: the row's "Último pago" only ever shows the most recent
          payment — this is the FULL history, any status, reusing the same
          tokens `student/payments/page.tsx` already established. */}
      <PaymentHistorySection
        personaId={personaId}
        refreshKey={historyVersion}
        onCorrected={onPaymentRegistered}
        onLoaded={(loaded) => {
          setPagosFailed(false);
          setPagos(loaded);
        }}
        onLoadFailed={() => setPagosFailed(true)}
      />

      {/* Everything else, quieter. Beneficio del club attaches to the PERSONA,
          not the membership (issue #398). `tarifaMensual` (issue #665) is the
          pre-submit UX hint that mirrors the backend's own assign-time gate;
          `undefined` when there is no membership yet. */}
      <section aria-label="Otras acciones" className="grid gap-3">
        <h3 className="text-sm font-bold text-ink-2">Otras acciones</h3>
        <div className="grid items-start gap-3 md:grid-cols-3">
          <div className="rounded-ctl border border-line bg-paper p-3">
            <BeneficioSection personaId={personaId} tarifaMensual={membresia?.monto} />
          </div>
          {!preguntarTipoSocio && membresia && membresia.estado === "activa" && (
            <div className="rounded-ctl border border-line bg-paper p-3">
              <ActionTile description="Pausa los cobros hasta que se reactive.">
                <SuspenderReactivarForm
                  membresiaId={Number(membresia.id)}
                  estado={membresia.estado}
                  onChanged={onMembresiaChanged}
                />
              </ActionTile>
            </div>
          )}
          {!preguntarTipoSocio && membresia && (
            <div className="rounded-ctl border border-line bg-paper p-3">
              <ActionTile description="La nueva tarifa rige desde el próximo pago.">
                <CambiarPlanForm
                  membresiaId={Number(membresia.id)}
                  tipoActual={membresia.tipo}
                  onChanged={onMembresiaChanged}
                />
              </ActionTile>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
