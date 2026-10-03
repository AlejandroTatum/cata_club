import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import TimePicker24 from "../TimePicker24";

const hour = (name: string) => within(screen.getByRole("group", { name: "Hora" })).getByRole("button", { name });
const minute = (name: string) => within(screen.getByRole("group", { name: "Minutos" })).getByRole("button", { name });

function Harness({ initial = "", onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TimePicker24
      id="hora"
      label="Hora de inicio"
      value={value}
      min="06:00"
      max="22:00"
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("TimePicker24", () => {
  it("shows a muted prompt when empty and the HH:MM value when set", () => {
    const { rerender } = render(
      <TimePicker24 id="hora" label="Hora de inicio" value="" min="06:00" max="22:00" onChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Hora de inicio" })).toHaveTextContent("Elegir hora");
    rerender(
      <TimePicker24 id="hora" label="Hora de inicio" value="17:05" min="06:00" max="22:00" onChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Hora de inicio" })).toHaveTextContent("17:05");
  });

  it("opens a dialog and marks the trigger expanded", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Hora de inicio" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("offers hours 06..22 and minutes 00..55 in steps of 5", () => {
    render(<Harness initial="17:00" />);
    fireEvent.click(screen.getByRole("button", { name: "Hora de inicio" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "06" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "22" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "23" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "55" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "03" })).not.toBeInTheDocument();
  });

  it("emits HH:MM after picking hour and minute, then closes", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Hora de inicio" }));
    fireEvent.click(hour("09"));
    fireEvent.click(minute("15"));
    expect(onChange).toHaveBeenLastCalledWith("09:15");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hora de inicio" })).toHaveTextContent("09:15");
  });

  it("forces minutes to 00 and hides the other minutes for hour 22", () => {
    const onChange = vi.fn();
    render(<Harness initial="17:45" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Hora de inicio" }));
    fireEvent.click(hour("22"));
    expect(onChange).toHaveBeenLastCalledWith("22:00");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "05" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "00" })).toHaveAttribute("aria-pressed", "true");
  });

  it("marks the current hour and minute as pressed", () => {
    render(<Harness initial="17:30" />);
    fireEvent.click(screen.getByRole("button", { name: "Hora de inicio" }));
    expect(hour("17")).toHaveAttribute("aria-pressed", "true");
    expect(minute("30")).toHaveAttribute("aria-pressed", "true");
    expect(hour("18")).toHaveAttribute("aria-pressed", "false");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Hora de inicio" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on outside click", () => {
    render(
      <div>
        <button type="button">fuera</button>
        <Harness />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hora de inicio" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "fuera" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("wires id, aria-invalid and aria-describedby on the trigger", () => {
    render(
      <TimePicker24
        id="categoria-hora-inicio"
        label="Hora de inicio"
        value=""
        min="06:00"
        max="22:00"
        onChange={() => {}}
        invalid
        describedBy="err"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Hora de inicio" });
    expect(trigger).toHaveAttribute("id", "categoria-hora-inicio");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAttribute("aria-describedby", "err");
  });
});
