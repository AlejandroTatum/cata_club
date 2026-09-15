/**
 * `/reset-password` — regression for #1209: `document.title` measured
 * "Cata Club Admin" on this recovery screen, inherited from the root
 * layout's `%s | Cata Club Admin` template with no page-level title to
 * fill it.
 *
 * `page.tsx` is a client component and cannot export `metadata` itself —
 * hence the sibling layout, same reason `/login` and `/login/activacion`
 * each carry one (see those `layout.tsx` files' own doc comments, #1195).
 *
 * `title.absolute`, not the admin template: a visitor setting a new
 * password from an email link is not staff.
 */

import { describe, it, expect } from "vitest";
import { metadata } from "@/app/reset-password/layout";

describe("reset-password layout metadata", () => {
  it("sets an absolute, non-admin title naming the club", () => {
    expect(metadata.title).toEqual({ absolute: "Restablecer contraseña — Cata Club" });
  });
});
