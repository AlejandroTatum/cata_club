/**
 * Niveles — Admin page for managing student nivel assignment.
 *
 * Thin wrapper over the shared `NivelAsignacionPanel` (see
 * src/components/nivel/NivelAsignacionPanel.tsx for the actual logic) — same
 * panel the trainer actor uses at `/trainer/nivel`, just a different
 * eyebrow/title/allowedRoles.
 *
 * Real backend gap for this actor (do not work around — documented at the
 * source instead of guessed here): initial group assignment (`POST
 * /ranking/asignar-nivel-inicial`) is backend-restricted to ENTRENADOR — an
 * ADMINISTRADOR gets a real 403. Moving an already-assigned student (`PATCH
 * /ranking/mover-de-nivel`) works fine for admins.
 */

"use client";

import NivelAsignacionPanel from "@/components/nivel/NivelAsignacionPanel";

export default function RankingPage(): React.ReactElement {
  return (
    <NivelAsignacionPanel
      eyebrow="Escalera de entrenamiento"
      title="Niveles"
      allowedRoles={["admin"]}
      backHref="/dashboard"
      backLabel="Volver al Panel"
    />
  );
}
