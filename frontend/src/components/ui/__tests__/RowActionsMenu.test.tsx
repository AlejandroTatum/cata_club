import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RowActionsMenu } from "@/components/ui";

function setup() {
  const onEdit = vi.fn();
  const onMedical = vi.fn();
  render(
    <RowActionsMenu
      label="Más acciones para Ana Paz"
      items={[
        { label: "Editar Ana Paz", onSelect: onEdit },
        { label: "Ficha médica de Ana Paz", onSelect: onMedical },
      ]}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Más acciones para Ana Paz" });
  return { trigger, onEdit, onMedical };
}

describe("RowActionsMenu", () => {
  it("is closed by default and announces itself as a menu button", () => {
    const { trigger } = setup();

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens on click and focuses the first item", () => {
    const { trigger } = setup();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.getByRole("menuitem", { name: "Editar Ana Paz" })).toHaveFocus();
  });

  it("moves between items with the arrow keys, wrapping at both ends", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: /ficha médica/i })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: /editar/i })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: /ficha médica/i })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: /editar/i })).toHaveFocus();
  });

  it("opens on the last item with ArrowUp from the trigger", () => {
    const { trigger } = setup();

    fireEvent.keyDown(trigger, { key: "ArrowUp" });

    expect(screen.getByRole("menuitem", { name: /ficha médica/i })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on a press outside", () => {
    const { trigger } = setup();
    fireEvent.click(trigger);

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("runs the chosen action after closing and restoring focus to the trigger", () => {
    const { trigger, onEdit, onMedical } = setup();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("menuitem", { name: "Editar Ana Paz" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onMedical).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
