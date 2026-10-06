/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NoClassDays from "../NoClassDays";

const fetchDiasSinClase = vi.fn();
vi.mock("@/services/api", () => ({ fetchDiasSinClase: (...args: unknown[]) => fetchDiasSinClase(...args) }));
vi.mock("@/lib/club-date", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/club-date")>()),
  clubIsoDate: () => "2029-06-14",
}));

describe("NoClassDays (member panel)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the upcoming days, soonest first, asking only from today", async () => {
    fetchDiasSinClase.mockResolvedValue([
      { id: 2, fechaInicio: "2029-07-10", fechaFin: "2029-07-12", motivo: "Cancha cerrada" },
      { id: 3, fechaInicio: "2029-06-01", fechaFin: "2029-06-02", motivo: "Ya pasó" },
      { id: 1, fechaInicio: "2029-07-04", fechaFin: "2029-07-04", motivo: "Feriado" },
    ]);
    render(<NoClassDays />);

    const panel = await screen.findByRole("complementary", { name: "Días sin clase" });
    expect(fetchDiasSinClase).toHaveBeenCalledWith({ desde: "2029-06-14" });
    const items = Array.from(panel.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual(["04/07/2029 · Feriado", "10/07/2029 – 12/07/2029 · Cancha cerrada"]);
    expect(screen.queryByText(/Ya pasó/)).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing announced or the lookup fails", async () => {
    fetchDiasSinClase.mockResolvedValueOnce([]);
    const { container, rerender } = render(<NoClassDays />);
    await waitFor(() => expect(fetchDiasSinClase).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();

    fetchDiasSinClase.mockRejectedValueOnce(new Error("down"));
    rerender(<div><NoClassDays key="again" /></div>);
    await waitFor(() => expect(fetchDiasSinClase).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
