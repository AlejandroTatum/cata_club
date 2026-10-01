"use client";

import BeneficioSection from "./BeneficioSection";
import PaymentHistorySection from "./PaymentHistorySection";
import CreateMembershipForm from "./CreateMembershipForm";
import RegisterPaymentForm from "./RegisterPaymentForm";
import RegularizarDeudaForm from "./RegularizarDeudaForm";
import SuspenderReactivarForm from "./SuspenderReactivarForm";
import CambiarPlanForm from "./CambiarPlanForm";
import { Badge, DataBox, PAGE_RAIL } from "@/components/ui";
import { formatCurrency } from "@/lib/format-utils";
import {
  formatMembershipPeriod,
  getMembershipStatusBadge,
  type MemberStudentSummary,
} from "./members-utils";

/**
 * The header strip of a student's Pagos block: where the membership stands
 * before any action is offered. Everything here is read from the row's own
 * data (no extra fetch), so it is correct the moment the dialog opens.
 */
function MembershipSummary({ student }: { student: MemberStudentSummary }): React.ReactElement {
  const { membresia } = student;
  if (!membresia) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-ctl border border-line bg-sunken px-4 py-3 text-sm text-ink-2">
        <Badge tone="neutral">Sin membresía</Badge>
        Cree una membresía para poder registrar pagos.
      </div>
    );
  }
  const { label, tone } = getMembershipStatusBadge(student);
  const period = formatMembershipPeriod(membresia.fechaInicio, membresia.fechaFin);
  return (
    <dl
      aria-label="Resumen de la membresía"
      className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-ctl border border-line bg-sunken px-4 py-3 text-xs"
    >
      <div>
        <dt className="text-ink-3">Estado</dt>
        <dd className="mt-1">
          <Badge tone={tone}>{label}</Badge>
        </dd>
      </div>
      <div>
        <dt className="text-ink-3">Plan</dt>
        <dd className="mt-1">
          <DataBox>{membresia.tipo}</DataBox>
        </dd>
      </div>
      <div>
        <dt className="text-ink-3">Tarifa mensual</dt>
        <dd className="mt-1">
          <DataBox>{membresia.esGratuidadFamiliar ? "Gratuidad familiar" : formatCurrency(membresia.monto)}</DataBox>
        </dd>
      </div>
      <div>
        <dt className="text-ink-3">Vigencia</dt>
        <dd className="mt-1">{period ? <DataBox>{period}</DataBox> : <span className="text-ink-3">—</span>}</dd>
      </div>
    </dl>
  );
}

/** One action of the dialog: a line saying what it does, then its trigger/form. */
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
    <div {...dataAttrs} className="grid gap-2 rounded-ctl border border-line bg-paper p-3">
      <p className="text-xs text-ink-2">{description}</p>
      {children}
    </div>
  );
}

/** Rows the history column is padded to so it matches the actions column's height. */
const HISTORY_MIN_ROWS = 7;

const ACTION_DESCRIPTION = {
  "registrar-pago": "Efectivo o transferencia, por período.",
  "regularizar-deuda": "Pagos atrasados de meses ya vencidos.",
} as const;

/**
 * The three refetch callbacks shared by every membership/payment write flow
 * for a student (Sonar duplication follow-up, issue #400): membership
 * creation, debt regularization, and suspend/reactivate/cambiar-plan each own
 * a named contract rather than collapsing into one generic "onChanged", and
 * every one of them currently resolves to the same `loadMembers` call at the
 * page level.
 *
 * Lives here (not in `page.tsx`) so both the account edit dialog's
 * "Estudiantes a cargo" section and the direct "Pagos" entry point (issue
 * #505) depend on the same contract without either importing the page
 * module.
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
 * a membership, register a payment, regularize debt, suspend/reactivate,
 * change plan. Extracted from `StudentEditPanel` (issue #505) so the exact
 * same block renders both inside the account edit dialog's "Estudiantes a
 * cargo" section and, directly, inside the new "Pagos" entry point: one
 * implementation, two entry points, no duplicated business logic or
 * validation.
 *
 * Which write flow is offered is decided here, and only here: a membership
 * is created when there is none, and a payment is registered against one
 * that exists — unchanged from the original `StudentEditPanel` logic.
 */
export default function StudentMembershipActions({
  personaId,
  student,
  onMembershipCreated,
  onDebtRegularized,
  onMembresiaChanged,
  onPaymentRegistered,
}: StudentMembershipActionsProps): React.ReactElement {
  const membresia = student.membresia;
  if (!student.activo) {
    return (
      <>
        <output className="text-xs text-ink-3">Inactivo/Archivado: historial disponible, acciones deshabilitadas.</output>
        <div className="mt-3">
          <PaymentHistorySection personaId={personaId} />
        </div>
      </>
    );
  }
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
  const regularizeDebt = membresia && (
    <RegularizarDeudaForm
      membresiaId={Number(membresia.id)}
      montoMensual={membresia.monto ?? 0}
      esGratuidadFamiliar={membresia.esGratuidadFamiliar}
      onRegularized={onDebtRegularized}
      primary={hasDebt}
    />
  );
  const registerPayment = membresia && (
    <RegisterPaymentForm
      personaId={personaId}
      membresia={membresia}
      onPaymentRegistered={onPaymentRegistered}
      primary={!hasDebt}
    />
  );
  const primaryAction = hasDebt
    ? { name: "regularizar-deuda" as const, content: regularizeDebt }
    : { name: "registrar-pago" as const, content: registerPayment };
  const secondaryAction = hasDebt
    ? { name: "registrar-pago" as const, content: registerPayment }
    : { name: "regularizar-deuda" as const, content: regularizeDebt };

  return (
    <div className="grid gap-section">
      <div className={PAGE_RAIL}>
        {/* Actions first in the DOM (and on a phone) so the primary one is
            reachable without scrolling past the history; from `lg` the history
            takes the wide column and the actions the rail. */}
        <section aria-label="Acciones" className="grid content-start gap-3 lg:order-2">
          <h3 className="text-sm font-bold text-ink">Acciones</h3>

          {!membresia && (
            <ActionTile description="Asigna un plan para poder registrar pagos.">
              <CreateMembershipForm personaId={personaId} onCreated={onMembershipCreated} />
            </ActionTile>
          )}

          {membresia && (
            <>
              {debtUnavailable && (
                <p className="text-2xs text-ink-3" role="status">
                  Estado de deuda no disponible; las acciones actuales siguen disponibles.
                </p>
              )}
              <ActionTile
                data-primary-action={primaryAction.name}
                description={ACTION_DESCRIPTION[primaryAction.name]}
              >
                {primaryAction.content}
              </ActionTile>
              <ActionTile
                data-secondary-action={secondaryAction.name}
                description={ACTION_DESCRIPTION[secondaryAction.name]}
              >
                {secondaryAction.content}
              </ActionTile>
            </>
          )}

          {/* Beneficio del club attaches to the PERSONA, not the membership
              (issue #398) — shown in the dedicated Pagos entry point.
              `tarifaMensual` (issue #665) is the pre-submit UX hint that mirrors
              the backend's own assign-time gate; `undefined` when there is no
              membership yet, same as the backend's own gate skipping then. */}
          <div className="rounded-ctl border border-line bg-paper p-3">
            <BeneficioSection personaId={personaId} tarifaMensual={membresia?.monto} />
          </div>

          {/* Suspension/reactivation and plan changes remain revealed secondary actions. */}
          {membresia && (membresia.estado === "activa" || membresia.estado === "suspendida") && (
            <ActionTile
              description={
                membresia.estado === "activa"
                  ? "Pausa los cobros hasta que se reactive."
                  : "Vuelve a activar la membresía."
              }
            >
              <SuspenderReactivarForm
                membresiaId={Number(membresia.id)}
                estado={membresia.estado}
                onChanged={onMembresiaChanged}
              />
            </ActionTile>
          )}
          {membresia && (
            <ActionTile description="La nueva tarifa rige desde el próximo pago.">
              <CambiarPlanForm membresiaId={Number(membresia.id)} onChanged={onMembresiaChanged} />
            </ActionTile>
          )}
        </section>

        {/* Issue #615: the row's "Último pago" only ever shows the most recent
            payment — this is the FULL history, any status, reusing the same
            tokens `student/payments/page.tsx` already established. */}
        <div className="grid min-w-0 content-start gap-section lg:order-1">
          <MembershipSummary student={student} />
          <PaymentHistorySection personaId={personaId} minRows={HISTORY_MIN_ROWS} />
        </div>
      </div>
    </div>
  );
}
