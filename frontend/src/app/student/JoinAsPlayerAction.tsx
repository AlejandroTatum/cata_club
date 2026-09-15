/**
 * "Unirme como jugador" (issue #1132) — a pure representative enrolls
 * THEIR OWN persona as a player and pays, without leaving the portal.
 *
 * Before this, the CTA pointed at `/student/enroll?type=self`, the PUBLIC
 * self-enrollment wizard — for an already-authenticated representante that
 * created a brand-new second Persona/Usuario instead of a membership for
 * their existing one (no self-service way existed to create a `Membresia`
 * for the caller's own persona_id; `POST /membresias/` was ADMIN-only).
 *
 * Reuses `TipoSelectorForm` (the SAME plan picker `CambiarPlanForm`/
 * `CreateMembershipForm` already use — fetch catalog, pick a plan, confirm)
 * rather than a new wizard. On success the membership exists (born
 * INACTIVA, see `MembresiaServicio.crear_membresia_propia`) and this hands
 * off to the EXISTING payment-registration door,
 * `/student/payments?registrar=1` — the same one `CuotaCard`'s own CTA
 * already opens for every other membership on this portal.
 */

"use client";

import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import TipoSelectorForm from "@/components/admin/TipoSelectorForm";
import { crearMembresiaPropia } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { withSelectedStudent } from "./ManagedStudentPicker";

interface JoinAsPlayerActionProps {
  /** The SESSION's own persona id — never the profile currently selected in
   *  the picker (see `ActivePortalView`'s own doc comment on `accountPersonaId`). */
  accountPersonaId: string;
}

export default function JoinAsPlayerAction({
  accountPersonaId,
}: JoinAsPlayerActionProps): React.ReactElement {
  const router = useRouter();
  const { showSuccess, showError } = useToast();

  return (
    <TipoSelectorForm
      triggerLabel="Unirme como jugador"
      TriggerIcon={UserPlus}
      submitLabel="Inscribirme"
      SubmitIcon={UserPlus}
      selectPlaceholder="Seleccionar plan…"
      submitFailureMessage="No se pudo crear la membresía."
      onSubmit={async (tipoMembresiaId) => {
        await crearMembresiaPropia(tipoMembresiaId);
        showSuccess("Membresía creada. Registre su primer pago para activarla.");
        router.push(withSelectedStudent("/student/payments?registrar=1", accountPersonaId));
      }}
      onSubmitError={showError}
    />
  );
}
