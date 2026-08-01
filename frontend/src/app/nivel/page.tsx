/**
 * Niveles — the admin's route onto the ladder.
 *
 * The screen itself is `NivelLadderScreen` (see
 * src/components/nivel/NivelLadderScreen.tsx), shared verbatim with the
 * trainer's `/trainer/nivel`: *"la pantalla de nivel tiene que ser la misma en
 * entrenador que la de admin."* Only the role this route admits differs; the
 * admin gets no back link because the sidebar already covers that navigation.
 *
 * This used to be served from `/ranking`. The competitive feature was removed
 * and the concept renamed to "nivel", but that sweep only reached the words on
 * the screen — the URL kept a name the product had already retired. The
 * trainer's route was born correct, which is what gave the mismatch away: the
 * same component and the same title under two different route names.
 *
 * A URL is interface. It is read in the address bar, shared in a message and
 * kept in bookmarks, so `/ranking` still answers — permanently redirected from
 * `next.config.js`. Breaking it would have traded a naming problem for an
 * availability one.
 *
 * The BFF routes under `/api/ranking/*` and the backend's own vocabulary are
 * deliberately NOT part of this: they are internal, nobody reads them, and
 * folding a large internal refactor into a user-facing fix makes both
 * impossible to review. Tracked separately.
 */

"use client";

import NivelLadderScreen from "@/components/nivel/NivelLadderScreen";

export default function NivelPage(): React.ReactElement {
  return <NivelLadderScreen title="Niveles" allowedRoles={["admin"]} />;
}
