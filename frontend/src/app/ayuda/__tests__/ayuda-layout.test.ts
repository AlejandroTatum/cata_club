/**
 * `/ayuda` — regression for #315 hallazgo #47: `document.title` measured
 * "Cata Club Admin" on an alumna's own portal (role "Jugador"). The route has
 * no `layout.tsx`, so with no page-level title to fill the root template's
 * `%s | Cata Club Admin`, Next falls back to the template's bare `default`.
 *
 * `page.tsx` is a client component and cannot export `metadata` itself —
 * hence the sibling layout, same reason `/student`, `/student/enroll` and
 * `/trainer` each carry one (see those `layout.tsx` files' own doc comments).
 *
 * `title.absolute`, not the admin template: `/ayuda` is reachable by every
 * role, most of them not admin.
 */

import { describe, it, expect } from "vitest";
import { metadata } from "@/app/ayuda/layout";

describe("ayuda layout metadata", () => {
  it("sets an absolute, non-admin title naming the screen itself", () => {
    expect(metadata.title).toEqual({ absolute: "Preguntas frecuentes — Cata Club" });
  });
});
