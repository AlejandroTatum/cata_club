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

  it("stays open when a scroll or resize fires right after opening", () => {
    const { trigger } = setup();

    fireEvent.click(trigger);
    fireEvent.scroll(window);
    fireEvent(window, new Event("resize"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("repositions under the trigger on scroll instead of closing", async () => {
    const { trigger } = setup();
    let bottom = 100;
    vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(
      () => ({ top: bottom - 32, bottom, left: 0, right: 300, width: 32, height: 32, x: 0, y: bottom - 32, toJSON: () => ({}) }) as DOMRect,
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    expect(menu.style.top).toBe("104px");

    bottom = 60;
    fireEvent.scroll(document, { target: { scrollY: 40 } });

    expect(screen.getByRole("menu").style.top).toBe("64px");
  });

  it("closes when the trigger scrolls out of the viewport", () => {
    const { trigger } = setup();
    let bottom = 100;
    vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(
      () => ({ top: bottom - 32, bottom, left: 0, right: 300, width: 32, height: 32, x: 0, y: bottom - 32, toJSON: () => ({}) }) as DOMRect,
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    fireEvent.click(trigger);
    bottom = -10;
    fireEvent.scroll(document);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("RowActionsMenu with a visible trigger label", () => {
  it("shows the label as text, keeps the row-specific accessible name, and still opens", () => {
    render(
      <RowActionsMenu
        label="Más acciones para Ana Paz"
        triggerLabel="Más"
        items={[{ label: "Editar Ana Paz", onSelect: vi.fn() }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Más acciones para Ana Paz" });

    expect(trigger).toHaveTextContent("Más");
    expect(trigger).toHaveAttribute("title", "Más acciones para Ana Paz");
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Editar Ana Paz" })).toBeInTheDocument();
  });
});

describe("RowActionsMenu alignment and custom trigger", () => {
  const rect = { top: 100, bottom: 132, left: 40, right: 72, width: 32, height: 32, x: 40, y: 100, toJSON: () => ({}) } as DOMRect;

  it("lines the menu up with the trigger's right edge by default", () => {
    const { trigger } = setup();
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rect);

    fireEvent.click(trigger);

    const menu = screen.getByRole("menu");
    expect(menu.style.right).toBe(`${window.innerWidth - 72}px`);
    expect(menu.style.left).toBe("");
  });

  it("lines the menu up with the trigger's left edge with align=\"start\", using the given icon and classes", () => {
    render(
      <RowActionsMenu
        label="Editar foto de perfil"
        align="start"
        triggerClassName="pencil-badge"
        triggerIcon={<svg data-testid="pencil-icon" />}
        items={[{ label: "Ver foto", onSelect: vi.fn() }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Editar foto de perfil" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rect);

    expect(trigger).toHaveClass("pencil-badge");
    expect(within(trigger).getByTestId("pencil-icon")).toBeInTheDocument();
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("40px");
    expect(menu.style.right).toBe("");
    expect(menu.style.top).toBe("136px");
  });
});
