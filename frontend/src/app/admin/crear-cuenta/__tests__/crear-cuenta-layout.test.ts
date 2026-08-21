/**
 * Regression for #489: `/admin/crear-cuenta` had no `layout.tsx`, so its
 * `"use client"` `page.tsx` could not export `metadata` and the tab sat on
 * the root layout's bare default, "Cata Club Admin", through all 5 steps.
 */

import { describe, it, expect } from "vitest";
import { metadata } from "@/app/admin/crear-cuenta/layout";

describe("crear-cuenta layout metadata", () => {
  it("names the screen, filling the admin template's %s", () => {
    expect(metadata.title).toEqual("Crear cuenta");
  });
});
