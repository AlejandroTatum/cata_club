/**
 * The global 404 — every route Next cannot match, in the whole product.
 *
 * Issue #316 hallazgo #55: `GET /students` (a typo of `/student`) and
 * `GET /settings` both rendered Next's own English placeholder — "404 | This
 * page could not be found.", `document.title` "404: This page could not be
 * found." — inside an app that is otherwise entirely Spanish, with no file
 * here to override it. There was nothing broken to fix; there was nothing
 * written at all.
 *
 * ## Why this is a Server Component that renders a Client one
 *
 * `not-found.tsx` is one of the few files Next assigns a fixed name and
 * meaning to (`page.tsx`, `layout.tsx`, `error.tsx`, …), so unlike `/ayuda`'s
 * `layout.tsx` + `page.tsx` pair, the metadata carrier and the route file are
 * the same file — and `metadata` can only be exported from a Server
 * Component. `useAuth()` needs a Client one. `NotFoundCard` is the split,
 * same reasoning as `ayuda/layout.tsx`'s note on `student/layout.tsx`.
 *
 * `title.absolute`: this route is reachable from EVERY role by definition (a
 * typo can happen from anywhere), so the root template ("%s | Cata Club
 * Admin") is not wrong, just not worth composing — the bare sentence is the
 * whole answer.
 */

import type { Metadata } from "next";
import NotFoundCard from "./NotFoundCard";

export const metadata: Metadata = {
  title: { absolute: "Página no encontrada — Cata Club" },
};

export default function NotFound(): React.ReactElement {
  return <NotFoundCard />;
}
