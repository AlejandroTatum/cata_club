/**
 * `/verificar-correo` — regression for #1196: the page rendered no metadata
 * of its own, inheriting the root layout's `%s | Cata Club Admin` title —
 * staff vocabulary shown to a visitor confirming their own address.
 *
 * `page.tsx` is a client component and cannot export `metadata` itself —
 * hence the sibling layout, same reason `/login/activacion` carries one.
 */

import { describe, it, expect } from "vitest";
import { metadata } from "@/app/verificar-correo/layout";

describe("verificar-correo layout metadata", () => {
  it("sets an absolute, non-admin title naming the club", () => {
    expect(metadata.title).toEqual({ absolute: "Verificación de correo — Cata Club" });
  });
});
