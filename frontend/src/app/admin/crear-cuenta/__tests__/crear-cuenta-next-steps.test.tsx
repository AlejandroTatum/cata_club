import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));

import CrearCuentaPage from "@/app/admin/crear-cuenta/page";

describe("legacy admin account route", () => {
  it("does not forward an administrator to public enrollment", () => {
    CrearCuentaPage();

    expect(redirect).toHaveBeenCalledWith("/members");
    expect(redirect).not.toHaveBeenCalledWith("/student/enroll");
  });
});
