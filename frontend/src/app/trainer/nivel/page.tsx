/**
 * Niveles — the trainer's route onto the ladder.
 *
 * *"la pantalla de nivel tiene que ser la misma en entrenador que la de
 * admin."* It is: this route renders the very same `NivelLadderScreen` the
 * admin's `/ranking` renders, with the same eyebrow and the same title. Only
 * the back link ("Volver a Entrenador") and the role this route admits differ,
 * which is the whole reason the two routes still exist instead of one.
 *
 * The trainer is not a lesser actor here — the backend grants ENTRENADOR both
 * `asignar-nivel-inicial` and `mover-de-nivel`, so every control on the screen
 * is theirs to use.
 */

"use client";

import NivelLadderScreen from "@/components/nivel/NivelLadderScreen";

export default function NivelPage(): React.ReactElement {
  return (
    <NivelLadderScreen
      eyebrow="Escalera de entrenamiento"
      title="Niveles"
      allowedRoles={["trainer"]}
      backHref="/trainer"
      backLabel="Volver a Entrenador"
    />
  );
}
