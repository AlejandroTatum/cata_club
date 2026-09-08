import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));

import CrearCuentaPage from "@/app/admin/crear-cuenta/page";

describe("retired admin account route", () => {
  it("does not restore an old wizard draft", () => {
    CrearCuentaPage();

    expect(redirect).toHaveBeenCalledWith("/members");
  });
});
