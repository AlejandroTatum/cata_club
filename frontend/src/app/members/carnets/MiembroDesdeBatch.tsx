/**
 * The «Miembro desde» editors of a printed batch (issue #1749), outside the
 * sheet so none of it prints.
 *
 * Closed when every player has a date — the sheet is the page — and open when
 * someone has none, so the gap is seen. That is decided once, when the batch
 * loads: saving the last missing date must not fold the block (and its
 * «Guardado.») away under the admin's hands.
 */

"use client";

import { useState } from "react";
import type { CarnetSummary } from "@/services/api";
import MiembroDesdeEditor from "./MiembroDesdeEditor";
import { hasUndatedPlayer } from "./carnet-sheet-utils";

export default function MiembroDesdeBatch({
  carnets,
  onSaved,
}: {
  carnets: readonly CarnetSummary[];
  onSaved: (personaId: string, miembroDesde: string | null) => void;
}): React.ReactElement {
  const [openAtLoad] = useState(() => hasUndatedPlayer(carnets));
  return (
    <details data-testid="miembro-desde-batch" open={openAtLoad} className="card px-5 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">Miembro desde de cada jugador</summary>
      <ul className="mt-3 grid gap-3">
        {carnets.map((carnet) => (
          <li key={carnet.profile.personaId}>
            <MiembroDesdeEditor
              personaId={carnet.profile.personaId}
              name={`${carnet.profile.nombres} ${carnet.profile.apellidos}`.trim()}
              value={carnet.profile.miembroDesde ?? null}
              onSaved={(value) => onSaved(carnet.profile.personaId, value)}
            />
          </li>
        ))}
      </ul>
    </details>
  );
}
