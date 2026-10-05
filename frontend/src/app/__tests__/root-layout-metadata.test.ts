/**
 * LAN-13 + TXT-11: the root title template is «<pantalla> — Cata Club» for the
 * whole product. It must not read `NEXT_PUBLIC_APP_NAME` («Cata Club Admin» in
 * every deploy), because the public legal pages inherit it.
 */

import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/fonts", () => ({ fontVariables: "" }));

import { generateMetadata } from "@/app/layout";
import { metadata as dashboardMetadata } from "@/app/dashboard/layout";
import { metadata as termsMetadata } from "@/app/terminos/page";

describe("root title template", () => {
  it("uses one em-dash separator and never says Admin", () => {
    expect(generateMetadata().title).toEqual({ default: "Cata Club", template: "%s — Cata Club" });
  });

  it("gives the dashboard a sentence-case title", () => {
    expect(dashboardMetadata.title).toBe("Panel de control");
  });

  it("keeps «Términos y condiciones» as a plain page title for the template", () => {
    expect(termsMetadata.title).toBe("Términos y condiciones");
  });
});
