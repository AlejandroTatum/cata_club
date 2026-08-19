/**
 * Cambiar el plan de una membresía YA existente — issue #400, criterio 1.
 *
 * Mismo esqueleto que `CreateMembershipForm` (mismo catálogo, misma forma):
 * la diferencia de negocio es que ESTA membresía ya existe, así que el
 * backend muta `tipo_membresia_id` en lugar de crear una fila nueva.
 * Prospectivo (decisión de producto ya tomada): la cobertura ya pagada no se
 * toca; la tarifa nueva rige recién desde el próximo pago que se registre.
 *
 * El mecanismo del selector (disparador, fetch del catálogo, `<select>`,
 * confirmar/cancelar, loading/error) vive en `TipoSelectorForm`, compartido
 * con `CreateMembershipForm` (Sonar duplication follow-up): las dos formas
 * repetían el mismo flujo casi textual, y solo difieren en QUÉ hace el
 * submit (crear vs. mutar una membresía existente).
 *
 * El selector NO excluye el plan actual de la lista: `MemberStudentSummary.
 * membresia` no expone `tipoMembresiaId` (solo un `tipo: string` ya
 * formateado para mostrar, no comparable de forma confiable contra el
 * catálogo), y agregarlo tocaría el adaptador del BFF (`members-adapter.ts`)
 * fuera del alcance pedido para esta entrega. El backend ya rechaza
 * "cambiar" al mismo tipo con un mensaje claro (`MENSAJE_CAMBIO_PLAN_MISMO_
 * TIPO`), que `toUserMessage` muestra si el admin lo elige por error.
 */

"use client";

import { CheckCircle2, Repeat } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { cambiarPlanMembresia } from "@/services/api";
import TipoSelectorForm from "@/components/admin/TipoSelectorForm";

interface CambiarPlanFormProps {
  membresiaId: number;
  /** Refetch the member list so the new plan (y su tarifa) aparece en el acto. */
  onChanged: () => void;
}

export default function CambiarPlanForm({
  membresiaId,
  onChanged,
}: CambiarPlanFormProps): React.ReactElement {
  const { showSuccess, showError } = useToast();

  return (
    <TipoSelectorForm
      triggerLabel="Cambiar plan"
      TriggerIcon={Repeat}
      submitLabel="Cambiar"
      SubmitIcon={CheckCircle2}
      selectPlaceholder="Seleccionar plan nuevo…"
      submitFailureMessage="Error al cambiar el plan de la membresía."
      onSubmitError={showError}
      onSubmit={async (nuevoTipoMembresiaId) => {
        await cambiarPlanMembresia(membresiaId, nuevoTipoMembresiaId);
        showSuccess("Plan cambiado correctamente.");
        onChanged();
      }}
    />
  );
}
