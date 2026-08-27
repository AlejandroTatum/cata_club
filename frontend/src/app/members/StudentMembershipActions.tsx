"use client";

import BeneficioSection from "./BeneficioSection";
import PaymentHistorySection from "./PaymentHistorySection";
import CreateMembershipForm from "./CreateMembershipForm";
import RegisterPaymentForm from "./RegisterPaymentForm";
import RegularizarDeudaForm from "./RegularizarDeudaForm";
import SuspenderReactivarForm from "./SuspenderReactivarForm";
import CambiarPlanForm from "./CambiarPlanForm";
import type { MemberStudentSummary } from "./members-utils";

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
}: StudentMembershipActionsProps): React.ReactElement {
  const membresia = student.membresia;
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
    />
  );
  const registerPayment = membresia && (
    <RegisterPaymentForm personaId={personaId} membresia={membresia} />
  );
  const primaryAction = hasDebt
    ? { name: "regularizar-deuda", content: regularizeDebt }
    : { name: "registrar-pago", content: registerPayment };
  const secondaryAction = hasDebt
    ? { name: "registrar-pago", content: registerPayment }
    : { name: "regularizar-deuda", content: regularizeDebt };

  return (
    <>
      {/* Beneficio del club attaches to the PERSONA, not the membership
          (issue #398) — shown in the dedicated Pagos entry point.
          `tarifaMensual` (issue #665) is the pre-submit UX hint that mirrors
          the backend's own assign-time gate; `undefined` when there is no
          membership yet, same as the backend's own gate skipping then. */}
      <BeneficioSection personaId={personaId} tarifaMensual={membresia?.monto} />

      {/* Issue #615: the row's "Último pago" only ever shows the most recent
          payment — this is the FULL history, any status, reusing the same
          tokens `student/payments/page.tsx` already established. */}
      <PaymentHistorySection personaId={personaId} />

      {!membresia && (
        <CreateMembershipForm personaId={personaId} onCreated={onMembershipCreated} />
      )}
      {membresia && (
        <div className="mt-2.5">
          {debtUnavailable && (
            <p className="mb-2 text-2xs text-ink-3" role="status">
              Estado de deuda no disponible; las acciones actuales siguen disponibles.
            </p>
          )}
          <div data-primary-action={primaryAction.name} className="rounded-lg border border-cata-red/40 p-2">
            {primaryAction.content}
          </div>
          <div data-secondary-action={secondaryAction.name}>
            {secondaryAction.content}
          </div>
          {/* Suspension/reactivation and plan changes remain revealed secondary actions. */}
          <SuspenderReactivarForm
            membresiaId={Number(membresia.id)}
            estado={membresia.estado}
            onChanged={onMembresiaChanged}
          />
          <CambiarPlanForm
            membresiaId={Number(membresia.id)}
            onChanged={onMembresiaChanged}
          />
        </div>
      )}
    </>
  );
}
