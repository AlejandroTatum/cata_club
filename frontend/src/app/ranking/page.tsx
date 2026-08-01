/**
 * Niveles — the admin's route onto the ladder.
 *
 * The screen itself is `NivelLadderScreen` (see
 * src/components/nivel/NivelLadderScreen.tsx), shared verbatim with the
 * trainer's `/trainer/nivel`: *"la pantalla de nivel tiene que ser la misma en
 * entrenador que la de admin."* Only the role this route admits differs; the
 * admin gets no back link because the sidebar already covers that navigation.
 */

"use client";

import NivelLadderScreen from "@/components/nivel/NivelLadderScreen";

export default function RankingPage(): React.ReactElement {
  return <NivelLadderScreen title="Niveles" allowedRoles={["admin"]} />;
}
