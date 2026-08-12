/**
 * The StudentSearch contract (issue #200): the text in the box and the
 * selected person's identity must never diverge. Selecting fills the input
 * and reports the identity upward; the built-in X or ANY later text edit
 * invalidates that identity and notifies the parent immediately — there is
 * no separate "Limpiar selección" action anywhere.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import StudentSearch from "@/components/StudentSearch";
import type { PersonaBusqueda } from "@/types/domain";

const ANA: PersonaBusqueda = { id: 35, nombres: "Ana", apellidos: "García" };
const LEO: PersonaBusqueda = { id: 12, nombres: "León", apellidos: "Fernández" };

const mockSearchStudents = vi.fn();

vi.mock("@/services/api", () => ({
  searchStudents: (...args: unknown[]) => mockSearchStudents(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchStudents.mockResolvedValue([ANA, LEO]);
});

afterEach(cleanup);

function renderSearch(onSelect: () => void = () => {}, onClear: () => void = () => {}): void {
  render(<StudentSearch onSelect={onSelect} onClear={onClear} />);
}

/** Types at least 2 chars and picks the first suggestion the box offers. */
async function pickFirstStudent(): Promise<void> {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Ana" } });
  fireEvent.click(await screen.findByRole("option", { name: /Ana García/i }));
}

describe("StudentSearch — selection identity contract (issue #200)", () => {
  it("reports the chosen student and mirrors their name into the box", async () => {
    const onSelect = vi.fn();
    renderSearch(onSelect);

    await pickFirstStudent();

    expect(onSelect).toHaveBeenCalledWith(ANA);
    expect(screen.getByRole("combobox")).toHaveValue("Ana García");
  });

  it("clearing with the built-in X notifies the parent and empties the box", async () => {
    const onClear = vi.fn();
    renderSearch(() => {}, onClear);

    await pickFirstStudent();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("editing the box after selecting invalidates the selection on the first keystroke", async () => {
    const onClear = vi.fn();
    renderSearch(() => {}, onClear);

    await pickFirstStudent();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Ana Garcí" } });

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox")).toHaveValue("Ana Garcí");
  });

  it("does not notify the parent again on later keystrokes of a fresh search", async () => {
    const onClear = vi.fn();
    renderSearch(() => {}, onClear);

    await pickFirstStudent();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Ana Garcí" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Ana García" } });

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("StudentSearch — autocomplete and accessibility contract", () => {
  it("keeps the autocomplete contract: 2 chars, 300ms debounce, 10 results max", async () => {
    vi.useFakeTimers();
    try {
      renderSearch();
      const input = screen.getByRole("combobox");

      fireEvent.change(input, { target: { value: "a" } });
      fireEvent.change(input, { target: { value: "an" } });
      await vi.advanceTimersByTimeAsync(299);
      expect(mockSearchStudents).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(mockSearchStudents).toHaveBeenCalledTimes(1);
      expect(mockSearchStudents).toHaveBeenCalledWith("an", { limit: 10 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps combobox semantics and an accessible clear button", async () => {
    renderSearch();

    const input = screen.getByRole("combobox");
    expect(input).toHaveAttribute("aria-label", "Buscar alumno");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");

    fireEvent.change(input, { target: { value: "An" } });
    const option = await screen.findByRole("option", { name: /Ana García/i });
    expect(option).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("button", { name: "Limpiar búsqueda" })).toBeInTheDocument();
  });
});
