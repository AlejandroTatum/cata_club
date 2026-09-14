/**
 * `/login` — regression for #1195: `document.title` measured "Cata Club
 * Admin" on the first screen a family reaches, inherited from the root
 * layout's `%s | Cata Club Admin` template with no page-level title to fill
 * it.
 *
 * `page.tsx` is a client component and cannot export `metadata` itself —
 * hence the sibling layout, same reason `/ayuda` and `/profile` each carry
 * one (see those `layout.tsx` files' own doc comments).
 *
 * `title.absolute`, not the admin template: /login is reached by anyone
 * signing in, most of them not admin.
 */

import { describe, it, expect } from "vitest";
import { metadata } from "@/app/login/layout";

describe("login layout metadata", () => {
  it("sets an absolute, non-admin title naming the club", () => {
    expect(metadata.title).toEqual({ absolute: "Iniciar sesión — Cata Club" });
  });
});
