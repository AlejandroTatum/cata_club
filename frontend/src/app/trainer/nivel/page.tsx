/**
 * Nivel — Trainer page for managing student nivel assignment.
 *
 * Thin wrapper over the shared `NivelAsignacionPanel` (see
 * src/components/nivel/NivelAsignacionPanel.tsx for the actual logic) —
 * same panel the admin actor uses at `/ranking`, just a different
 * eyebrow/title/allowedRoles.
 */

"use client";

import NivelAsignacionPanel from "@/components/nivel/NivelAsignacionPanel";

export default function NivelPage(): React.ReactElement {
  return (
    <NivelAsignacionPanel
      eyebrow="Área de entrenadores"
      title="Niveles"
      allowedRoles={["trainer"]}
      backHref="/trainer"
      backLabel="Volver a Entrenador"
    />
  );
}
