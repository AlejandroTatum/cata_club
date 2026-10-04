/** Tab titles of the admin screens that had none (LAN-13). */

import { describe, it, expect } from "vitest";
import { metadata as galeria } from "@/app/galeria/layout";
import { metadata as sponsors } from "@/app/sponsors/layout";
import { metadata as reportesError } from "@/app/admin/reportes-error/layout";

describe("admin route titles", () => {
  it("names each screen instead of inheriting the site default", () => {
    expect(galeria.title).toBe("Galería");
    expect(sponsors.title).toBe("Patrocinadores");
    expect(reportesError.title).toBe("Errores reportados");
  });
});
