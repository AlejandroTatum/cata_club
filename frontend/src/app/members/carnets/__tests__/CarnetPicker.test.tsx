/**
 * The carnet picker's usability (T14B / RC7, S9, S12): the family name sits
 * under the player and is visible on a phone, the search is not a card inside a
 * card, the selection can be made and unmade in bulk, and the bar says how many
 * are chosen and why it cannot print yet. Zero, few and past-the-limit lists.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import CarnetPicker from "@/app/members/carnets/CarnetPicker";
import { MAX_CARNETS } from "@/app/members/carnets/carnet-sheet-utils";
import type { MemberAccount } from "@/app/members/members-utils";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockFetchMembers = vi.fn();
vi.mock("@/services/api", () => ({ fetchMembers: () => mockFetchMembers() }));

function player(id: number, extra: Partial<MemberAccount> = {}): MemberAccount {
  return {
    id: String(id),
    role: "estudiante",
    nombres: `Jugador${id}`,
    apellidos: "Alcivar",
    telefono: "1",
    estudiantes: [],
    backendRoles: ["ALUMNO"],
    ...extra,
  };
}

async function renderPicker(accounts: MemberAccount[]): Promise<void> {
  mockFetchMembers.mockResolvedValue({ accounts });
  render(<CarnetPicker />);
  await screen.findByTestId("carnet-picker");
}

const generate = (): HTMLElement => screen.getByRole("button", { name: /generar/i });

beforeEach(() => {
  mockPush.mockReset();
  mockFetchMembers.mockReset();
});

describe("CarnetPicker — a row", () => {
  it("names who represents a minor on a second line, readable and not hidden on a phone", async () => {
    await renderPicker([player(1, { representadoPor: "Rosa Vera" }), player(2)]);

    const note = screen.getByText("Representado por Rosa Vera");
    expect(note).toHaveClass("text-xs", "text-ink-2");
    // `hidden sm:inline` made the disambiguation vanish exactly on a phone.
    expect(note.className).not.toMatch(/\bhidden\b/);
    // Under the name, in the same row; the face is the app's own, not a 2xs tracked label.
    expect(note.className).not.toMatch(/text-2xs|tracking/);
    const row = note.closest("li") as HTMLElement;
    expect(within(row).getByText("Jugador1 Alcivar")).toBeInTheDocument();
    expect(within(screen.getAllByRole("listitem")[1]).queryByText(/Representado por/)).not.toBeInTheDocument();
  });

  it("draws a 20px checkbox inside a row that is at least 44px tall", async () => {
    await renderPicker([player(1)]);
    expect(screen.getByRole("checkbox", { name: "Elegir a Jugador1 Alcivar" })).toHaveClass("h-5", "w-5");
    expect(screen.getByRole("listitem").firstElementChild).toHaveClass("min-h-11");
  });
});

describe("CarnetPicker — the search", () => {
  it("is a flat control, not a card inside the picker's card", async () => {
    await renderPicker([player(1)]);
    const search = screen.getByRole("searchbox", { name: "Buscar jugadores" });
    expect(search.closest(".card")).toBeNull();
    expect(screen.getByTestId("carnet-picker").querySelectorAll(".card").length).toBeLessThanOrEqual(1);
  });

  it("says nothing matched and offers the way back, without losing the selection", async () => {
    await renderPicker([player(1), player(2)]);
    fireEvent.click(screen.getByRole("checkbox", { name: /Jugador1/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

    expect(screen.getByText("Ningún jugador coincide con la búsqueda.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 de 2 seleccionados");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});

describe("CarnetPicker — choosing in bulk", () => {
  it("chooses what the search leaves visible, then clears the whole selection", async () => {
    await renderPicker([player(1, { apellidos: "Vera" }), player(2, { apellidos: "Vera" }), player(3)]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "vera" } });

    fireEvent.click(screen.getByRole("button", { name: "Elegir visibles (2)" }));
    expect(screen.getByRole("status")).toHaveTextContent("2 de 3 seleccionados");
    expect(screen.getByRole("button", { name: "Elegir visibles (2)" })).toBeDisabled();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Quitar selección" }));
    expect(screen.getByRole("status")).toHaveTextContent("0 de 3 seleccionados");
    expect(screen.getByRole("button", { name: "Quitar selección" })).toBeDisabled();
  });

  it(`stops at ${MAX_CARNETS} and says so before the admin hits the wall`, async () => {
    await renderPicker(Array.from({ length: MAX_CARNETS + 10 }, (_, index) => player(index + 1)));
    expect(screen.getByText(new RegExp(`máximo ${MAX_CARNETS}`, "i"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Elegir visibles (${MAX_CARNETS + 10})` }));
    expect(screen.getByRole("status")).toHaveTextContent(`${MAX_CARNETS} de ${MAX_CARNETS + 10} seleccionados`);
    expect(screen.getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked)).toHaveLength(MAX_CARNETS);
    expect(screen.getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).disabled)).toHaveLength(10);
    expect(screen.getByText(/Llegaste al máximo/)).toBeInTheDocument();
  });
});

describe("CarnetPicker — the selection bar", () => {
  it("is disabled with its reason beside it until someone is chosen", async () => {
    await renderPicker([player(1), player(2)]);
    const bar = screen.getByTestId("carnet-selection-bar");
    expect(bar).toHaveAttribute("data-bottom-bar");

    expect(within(bar).getByRole("status")).toHaveTextContent("0 de 2 seleccionados");
    expect(generate()).toBeDisabled();
    const reason = within(bar).getByText("Elige al menos un jugador.");
    expect(generate().getAttribute("aria-describedby")).toBe(reason.id);

    fireEvent.click(screen.getByRole("checkbox", { name: /Jugador1/ }));
    expect(generate()).toBeEnabled();
    expect(generate()).toHaveTextContent("Generar 1 carnet");
    expect(within(bar).queryByText("Elige al menos un jugador.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /Jugador2/ }));
    expect(generate()).toHaveTextContent("Generar 2 carnets");
    fireEvent.click(generate());
    expect(mockPush).toHaveBeenCalledWith("/members/carnets?ids=1%2C2");
  });
});

describe("CarnetPicker — nobody to choose", () => {
  it("shows an empty state instead of a dead toolbar and a disabled bar", async () => {
    mockFetchMembers.mockResolvedValue({ accounts: [] });
    render(<CarnetPicker />);

    expect(await screen.findByText("Aún no hay jugadores")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByTestId("carnet-selection-bar")).not.toBeInTheDocument();
  });
});
