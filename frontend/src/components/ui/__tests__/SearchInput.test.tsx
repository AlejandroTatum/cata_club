/**
 * SearchInput — 40px, with the whole box acting as the field's label so the
 * icon and the padding are click targets, not decoration.
 *
 * @vitest-environment jsdom
 */

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SearchInput from "@/components/ui/SearchInput";
import { committedHeight, committedRadius } from "./ui-test-utils";

function frameOf(input: HTMLElement): HTMLElement {
  return input.closest("label") as HTMLElement;
}

describe("SearchInput — committed dimensions", () => {
  it("is 40px tall", () => {
    render(<SearchInput label="Buscar miembros" value="" onChange={vi.fn()} />);
    expect(committedHeight(frameOf(screen.getByRole("searchbox")))).toBe("40px");
  });

  it("uses the 10px control radius", () => {
    render(<SearchInput label="Buscar miembros" value="" onChange={vi.fn()} />);
    expect(committedRadius(frameOf(screen.getByRole("searchbox")))).toBe("10px");
  });
});

describe("SearchInput — accessibility", () => {
  it("gives the field an accessible name without a visible label", () => {
    render(<SearchInput label="Buscar por nombre o correo" value="" onChange={vi.fn()} />);
    expect(screen.getByRole("searchbox", { name: "Buscar por nombre o correo" })).toBeInTheDocument();
  });

  it("wraps the control in a label so the icon and padding focus the input", () => {
    render(<SearchInput label="Buscar" value="" onChange={vi.fn()} />);
    expect(frameOf(screen.getByRole("searchbox")).tagName).toBe("LABEL");
  });
});

describe("SearchInput — behavior", () => {
  it("reports the typed value", () => {
    const onChange = vi.fn();
    render(<SearchInput label="Buscar" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Ana" } });
    expect(onChange).toHaveBeenCalledWith("Ana");
  });

  it("is controlled by its value prop", () => {
    function Harness(): React.ReactElement {
      const [value, setValue] = useState("");
      return <SearchInput label="Buscar" value={value} onChange={setValue} />;
    }
    render(<Harness />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "Laura" } });
    expect(input).toHaveValue("Laura");
  });

  it("renders the placeholder and the optional shortcut hint", () => {
    render(
      <SearchInput
        label="Buscar"
        placeholder="Buscar por nombre o correo"
        shortcut="Ctrl K"
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("Buscar por nombre o correo")).toBeInTheDocument();
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
  });

  it("omits the shortcut hint when not supplied", () => {
    render(<SearchInput label="Buscar" value="" onChange={vi.fn()} />);
    expect(frameOf(screen.getByRole("searchbox")).querySelector("kbd")).toBeNull();
  });
});
