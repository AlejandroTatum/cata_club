/**
 * Niveles — the admin's route onto the ladder.
 *
 * The screen itself is `NivelLadderScreen` (see
 * src/components/nivel/NivelLadderScreen.tsx), shared verbatim with the
 * trainer's `/trainer/nivel`: *"la pantalla de nivel tiene que ser la misma en
 * entrenador que la de admin."* Only the back link and the role this route
 * admits differ.
 */

"use client";

import NivelLadderScreen from "@/components/nivel/NivelLadderScreen";

export default function RankingPage(): React.ReactElement {
  return (
    <NivelLadderScreen
      eyebrow="Escalera de entrenamiento"
      title="Niveles"
      allowedRoles={["admin"]}
      backHref="/dashboard"
      backLabel="Volver al Panel"
    />
  );
}
