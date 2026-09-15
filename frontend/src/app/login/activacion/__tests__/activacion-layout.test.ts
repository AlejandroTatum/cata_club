/**
 * `/login/activacion` — regression for #1195: `document.title` measured
 * "Cata Club Admin" on the gate an authenticated visitor lands on while
 * finishing enrolment, inherited from the root layout's own template with
 * no page-level title to fill it.
 *
 * `page.tsx` is a client component and cannot export `metadata` itself —
 * hence the sibling layout, same reason `/ayuda` and `/profile` each carry
 * one (see those `layout.tsx` files' own doc comments).
 *
 * `title.absolute`, overriding `/login/layout.tsx`'s own override in turn:
 * this gate is not the sign-in form, and neither is the visitor on it staff.
 */

import { describe, it, expect } from "vitest";
import { metadata } from "@/app/login/activacion/layout";

describe("activacion layout metadata", () => {
  it("sets an absolute, non-admin title naming the club", () => {
    expect(metadata.title).toEqual({ absolute: "Verifique su cuenta — Cata Club" });
  });
});
