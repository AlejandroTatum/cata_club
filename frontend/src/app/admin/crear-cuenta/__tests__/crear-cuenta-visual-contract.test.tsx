import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));

import CrearCuentaPage from "@/app/admin/crear-cuenta/page";

describe("legacy admin account route", () => {
  it("does not render or expose an account-creation wizard", () => {
    CrearCuentaPage();

    expect(redirect).toHaveBeenCalledWith("/members");
  });
});
