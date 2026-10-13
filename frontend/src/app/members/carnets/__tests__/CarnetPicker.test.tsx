/**
 * The carnet picker's usability (T14B / RC7, S9, S12): the family name sits
 * under the player and is visible on a phone, the search is not a card inside a
 * card, the selection can be made and unmade in bulk, and the bar says how many
 * are chosen and why it cannot print yet. Zero, few and past-the-limit lists.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CarnetPicker from "@/app/members/carnets/CarnetPicker";
import { MAX_CARNETS } from "@/app/members/carnets/carnet-sheet-utils";
import { MEMBERS_PAGE_SIZE, type MemberAccount } from "@/app/members/members-utils";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockFetchMembers = vi.fn();
const mockSetMiembroDesde = vi.fn();
vi.mock("@/services/api", () => ({
  fetchMembers: () => mockFetchMembers(),
  setMiembroDesde: (personaId: string, value: string | null) => mockSetMiembroDesde(personaId, value),
}));

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
  mockSetMiembroDesde.mockReset();
});

const PAGE = MEMBERS_PAGE_SIZE;
const rowCount = (): number => screen.getAllByRole("listitem").length;
const status = (): HTMLElement => within(screen.getByTestId("carnet-selection-bar")).getByRole("status");

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

describe("CarnetPicker — «Miembro desde» on the row (#1749, S1)", () => {
  const rowOf = (name: string): HTMLElement => screen.getByText(name).closest("li") as HTMLElement;

  it("shows the month and year on record, or «Sin fecha», with an «Editar» button per row", async () => {
    await renderPicker([player(1, { miembroDesde: "2019-03-01" }), player(2), player(3, { miembroDesde: null })]);

    expect(within(rowOf("Jugador1 Alcivar")).getByText("Miembro desde mar 2019")).toBeInTheDocument();
    expect(within(rowOf("Jugador2 Alcivar")).getByText("Sin fecha")).toBeInTheDocument();
    expect(within(rowOf("Jugador3 Alcivar")).getByText("Sin fecha")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Editar Miembro desde de / })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Editar Miembro desde de Jugador1 Alcivar" })).toHaveTextContent("Editar");
  });

  it("opens the editor on that row only, without toggling the row's checkbox", async () => {
    await renderPicker([player(1), player(2)]);
    const edit = screen.getByRole("button", { name: "Editar Miembro desde de Jugador1 Alcivar" });
    expect(edit).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(edit);

    expect(within(rowOf("Jugador1 Alcivar")).getByLabelText("Miembro desde de Jugador1 Alcivar")).toBeInTheDocument();
    expect(screen.queryByLabelText("Miembro desde de Jugador2 Alcivar")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Elegir a Jugador1 Alcivar" })).not.toBeChecked();
    expect(status()).toHaveTextContent("0 de 2 seleccionados");
    expect(screen.getByRole("button", { name: "Cerrar Miembro desde de Jugador1 Alcivar" })).toHaveAttribute("aria-expanded", "true");
    // The checkbox is not wrapped by the same label as the controls it must not toggle.
    expect(edit.closest("label")).toBeNull();
  });

  it("clicking the name still toggles the checkbox", async () => {
    await renderPicker([player(1)]);
    fireEvent.click(screen.getByText("Jugador1 Alcivar"));
    expect(screen.getByRole("checkbox", { name: "Elegir a Jugador1 Alcivar" })).toBeChecked();
  });

  it("saves in place: the row shows the new date, the list is not reloaded and the selection is kept", async () => {
    mockSetMiembroDesde.mockResolvedValue({ miembroDesde: "2019-03-01" });
    await renderPicker([player(1), player(2)]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Elegir a Jugador2 Alcivar" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar Miembro desde de Jugador1 Alcivar" }));

    fireEvent.change(screen.getByLabelText("Miembro desde de Jugador1 Alcivar"), { target: { value: "2019-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(mockSetMiembroDesde).toHaveBeenCalledWith("1", "2019-03"));
    expect(await within(rowOf("Jugador1 Alcivar")).findByText("Miembro desde mar 2019")).toBeInTheDocument();
    expect(mockFetchMembers).toHaveBeenCalledTimes(1);
    expect(status()).toHaveTextContent("1 de 2 seleccionados");
  });

  it("clears the date from the row with «Quitar»", async () => {
    mockSetMiembroDesde.mockResolvedValue({ miembroDesde: null });
    await renderPicker([player(1, { miembroDesde: "2019-03-01" })]);
    fireEvent.click(screen.getByRole("button", { name: "Editar Miembro desde de Jugador1 Alcivar" }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));

    await waitFor(() => expect(mockSetMiembroDesde).toHaveBeenCalledWith("1", null));
    expect(await within(rowOf("Jugador1 Alcivar")).findByText("Sin fecha")).toBeInTheDocument();
  });

  it("shows the editor's own errors and leaves the row as it was", async () => {
    mockSetMiembroDesde.mockRejectedValue(new Error("boom"));
    await renderPicker([player(1, { miembroDesde: "2019-03-01" })]);
    fireEvent.click(screen.getByRole("button", { name: "Editar Miembro desde de Jugador1 Alcivar" }));
    fireEvent.change(screen.getByLabelText("Miembro desde de Jugador1 Alcivar"), { target: { value: "2020-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(within(rowOf("Jugador1 Alcivar")).getByText("Miembro desde mar 2019")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Miembro desde de Jugador1 Alcivar"), { target: { value: "2012-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("No puede ser anterior a octubre de 2013.")).toBeInTheDocument();
  });

  it("keeps «Editar» usable on a row blocked by the ceiling", async () => {
    await renderPicker(Array.from({ length: MAX_CARNETS + 1 }, (_, index) => player(index + 1)));
    for (let chosen = 0; chosen < MAX_CARNETS; chosen += PAGE) {
      fireEvent.click(screen.getByRole("button", { name: `Elegir esta página (${PAGE})` }));
      fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    }
    const last = `Jugador${MAX_CARNETS + 1} Alcivar`;
    expect(screen.getByRole("checkbox", { name: `Elegir a ${last}` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `Editar Miembro desde de ${last}` })).toBeEnabled();
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
    expect(status()).toHaveTextContent("1 de 2 seleccionados");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});

describe("CarnetPicker — choosing in bulk", () => {
  it("chooses what the search leaves visible, then clears the whole selection", async () => {
    await renderPicker([player(1, { apellidos: "Vera" }), player(2, { apellidos: "Vera" }), player(3)]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "vera" } });

    fireEvent.click(screen.getByRole("button", { name: "Elegir visibles (2)" }));
    expect(status()).toHaveTextContent("2 de 3 seleccionados");
    expect(screen.getByRole("button", { name: "Elegir visibles (2)" })).toBeDisabled();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Quitar selección" }));
    expect(status()).toHaveTextContent("0 de 3 seleccionados");
    expect(screen.getByRole("button", { name: "Quitar selección" })).toBeDisabled();
  });

  it(`stops at ${MAX_CARNETS} across pages and says so before the admin hits the wall`, async () => {
    await renderPicker(Array.from({ length: MAX_CARNETS + 10 }, (_, index) => player(index + 1)));
    expect(screen.getByText(new RegExp(`máximo ${MAX_CARNETS}`, "i"))).toBeInTheDocument();

    // One page at a time: choose the page, go to the next, until the ceiling.
    for (let chosen = 0; chosen < MAX_CARNETS; chosen += PAGE) {
      fireEvent.click(screen.getByRole("button", { name: `Elegir esta página (${PAGE})` }));
      if (chosen + PAGE < MAX_CARNETS) fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    }
    expect(status()).toHaveTextContent(`${MAX_CARNETS} de ${MAX_CARNETS + 10} seleccionados`);
    expect(screen.getByText(/Llegaste al máximo/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(screen.getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).disabled)).toHaveLength(10);
  });

  it("cuts a page's choice off at the ceiling instead of overshooting it", async () => {
    await renderPicker(Array.from({ length: MAX_CARNETS + 10 }, (_, index) => player(index + 1)));
    for (let chosen = 0; chosen < MAX_CARNETS - 4; chosen += PAGE) {
      fireEvent.click(screen.getByRole("button", { name: `Elegir esta página (${PAGE})` }));
      fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    }
    fireEvent.click(screen.getByRole("button", { name: `Elegir esta página (${PAGE})` }));
    expect(status()).toHaveTextContent(`${MAX_CARNETS} de ${MAX_CARNETS + 10} seleccionados`);
  });
});

describe("CarnetPicker — pagination (#1749, S2)", () => {
  const many = (count: number): MemberAccount[] => Array.from({ length: count }, (_, index) => player(index + 1));

  it("shows one page of rows with the Miembros pager, and no pager when everyone fits", async () => {
    await renderPicker(many(PAGE + 5));
    expect(rowCount()).toBe(PAGE);
    expect(screen.getByText("Jugador1 Alcivar")).toBeInTheDocument();
    expect(screen.queryByText(`Jugador${PAGE + 1} Alcivar`)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeInTheDocument();
    expect(screen.getByTestId("carnet-picker").querySelectorAll(".card").length).toBeLessThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(rowCount()).toBe(5);
    expect(screen.getByText(`Jugador${PAGE + 1} Alcivar`)).toBeInTheDocument();
  });

  it("has no pager for a list that fits in one page", async () => {
    await renderPicker(many(PAGE));
    expect(screen.queryByRole("button", { name: /siguiente/i })).not.toBeInTheDocument();
  });

  it("keeps the selection across pages, counts the whole of it and unticks nothing on return", async () => {
    await renderPicker(many(PAGE + 5));
    fireEvent.click(screen.getByRole("checkbox", { name: "Elegir a Jugador1 Alcivar" }));
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: `Elegir a Jugador${PAGE + 1} Alcivar` }));

    expect(status()).toHaveTextContent(`2 de ${PAGE + 5} seleccionados`);
    fireEvent.click(screen.getByRole("button", { name: /anterior/i }));
    expect(screen.getByRole("checkbox", { name: "Elegir a Jugador1 Alcivar" })).toBeChecked();

    fireEvent.click(generate());
    expect(mockPush).toHaveBeenCalledWith(`/members/carnets?ids=1%2C${PAGE + 1}`);
  });

  it("«Elegir esta página» chooses only the rows on the current page and keeps earlier choices", async () => {
    await renderPicker(many(PAGE * 2 + 3));
    fireEvent.click(screen.getByRole("button", { name: `Elegir esta página (${PAGE})` }));
    expect(status()).toHaveTextContent(`${PAGE} de ${PAGE * 2 + 3} seleccionados`);
    expect(screen.getByRole("button", { name: `Elegir esta página (${PAGE})` })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    fireEvent.click(screen.getByRole("button", { name: `Elegir esta página (${PAGE})` }));
    expect(status()).toHaveTextContent(`${PAGE * 2} de ${PAGE * 2 + 3} seleccionados`);

    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(screen.getByRole("button", { name: "Elegir esta página (3)" })).toBeEnabled();
  });

  it("paginates what the search leaves, keeps the selection through it, and goes back to page 1 when it changes", async () => {
    await renderPicker([
      ...Array.from({ length: PAGE + 4 }, (_, index) => player(index + 1, { apellidos: "Vera" })),
      player(900, { apellidos: "Otro" }),
    ]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Elegir a Jugador1 Vera" }));
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(rowCount()).toBe(5); // PAGE + 5 players in all, 4 + 1 on page 2

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "vera" } });
    // Back on page 1 of the filtered list: PAGE rows, then 4 on the second page.
    expect(rowCount()).toBe(PAGE);
    expect(screen.getByRole("checkbox", { name: "Elegir a Jugador1 Vera" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(rowCount()).toBe(4);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "otro" } });
    expect(rowCount()).toBe(1);
    expect(screen.queryByRole("button", { name: /siguiente/i })).not.toBeInTheDocument();
    expect(status()).toHaveTextContent(`1 de ${PAGE + 5} seleccionados`);
  });

  it("labels the bulk button by what it really does: visible when there is one page, this page when there are several", async () => {
    await renderPicker(many(PAGE + 5));
    expect(screen.queryByRole("button", { name: /elegir visibles/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Elegir esta página (${PAGE})` })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Jugador15" } });
    expect(screen.getByRole("button", { name: "Elegir visibles (1)" })).toBeInTheDocument();
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
