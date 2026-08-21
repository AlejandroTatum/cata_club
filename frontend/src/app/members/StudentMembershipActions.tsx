"use client";

import BeneficioSection from "./BeneficioSection";
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
  return (
    <>
      {/* Beneficio del club attaches to the PERSONA, not the membership
          (issue #398) — shown regardless of whether the student currently
          has a membresia, unlike the two forms below it. */}
      <BeneficioSection personaId={personaId} />

      {!student.membresia && (
        <CreateMembershipForm personaId={personaId} onCreated={onMembershipCreated} />
      )}
      {student.membresia && (
        <div className="mt-2.5">
          <RegisterPaymentForm personaId={personaId} membresia={student.membresia} />
          <RegularizarDeudaForm
            membresiaId={Number(student.membresia.id)}
            montoMensual={student.membresia.monto ?? 0}
            esGratuidadFamiliar={student.membresia.esGratuidadFamiliar}
            onRegularized={onDebtRegularized}
          />
          {/* Issue #400, criterio 3: solo administración suspende/reactiva
              (texto explícito del issue) — el componente decide por sí solo
              si corresponde "Suspender" o "Reactivar" según el estado
              actual, y no se ofrece ninguno de los dos desde VENCIDA. */}
          <SuspenderReactivarForm
            membresiaId={Number(student.membresia.id)}
            estado={student.membresia.estado}
            onChanged={onMembresiaChanged}
          />
          {/* Issue #400, criterio 1: cambio de plan PROSPECTIVO sobre esta
              misma membresía — la cobertura ya pagada no se toca. */}
          <CambiarPlanForm
            membresiaId={Number(student.membresia.id)}
            onChanged={onMembresiaChanged}
          />
        </div>
      )}
    </>
  );
}
