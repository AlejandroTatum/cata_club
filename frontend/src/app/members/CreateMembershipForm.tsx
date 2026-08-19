/**
 * Create a membership for a student who has none — the first of the two
 * independent forms inside a student's edit panel.
 *
 * It owns every piece of state its own flow needs (catalog, selection,
 * in-flight, error, success) and tells the page nothing except "a membership
 * now exists", via `onCreated`. Nothing here is shared with the payment form
 * beside it: they open independently, fail independently, and the only thing
 * they have in common is the student they hang off.
 *
 * The catalog-picker mechanics (trigger, fetch-on-open, `<select>`, submit/
 * cancel, loading/error) live in `TipoSelectorForm` — shared with
 * `CambiarPlanForm` (issue #400, criterio 1), which repeated this same flow
 * for an EXISTING membership's plan (Sonar duplication follow-up).
 */

"use client";

import { CheckCircle2, Plus } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { crearMembresia } from "@/services/api";
import TipoSelectorForm from "@/components/admin/TipoSelectorForm";

interface CreateMembershipFormProps {
  personaId: number;
  /** Refetch the member list so the new membership appears in place. */
  onCreated: () => void;
}

export default function CreateMembershipForm({
  personaId,
  onCreated,
}: CreateMembershipFormProps): React.ReactElement {
  const { showSuccess, showError } = useToast();

  return (
    <TipoSelectorForm
      triggerLabel="Crear membresía"
      TriggerIcon={Plus}
      submitLabel="Crear"
      SubmitIcon={Plus}
      selectPlaceholder="Seleccionar tipo…"
      submitFailureMessage="Error al crear la membresía."
      onSubmitError={showError}
      onSubmit={async (tipoMembresiaId) => {
        // Only who and which plan. The catalogue price is still fetched and
        // shown in the selector so the admin sees what they are assigning,
        // but it is NOT sent: the backend resolves the current tariff from
        // `tipoMembresiaId` (issue #400). Echoing the price back would make
        // the number the club charges with editable in transit.
        await crearMembresia({ personaId, tipoMembresiaId });
        showSuccess("Membresía creada correctamente.");
        onCreated();
      }}
      renderSuccess={() => (
        <p className="mt-2 flex items-center gap-1 text-xs text-state-ok">
          <CheckCircle2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Membresía creada.
        </p>
      )}
    />
  );
}
