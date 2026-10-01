import { fireEvent, within } from "@testing-library/react";

/**
 * A row action by accessible name, wherever the row keeps it.
 *
 * Pagos is a visible button; Editar and Ficha médica live in the row's
 * "Más acciones para <nombre>" menu, which is portalled to `document.body`
 * and only exists while open. This opens the menu when the action is not a
 * visible button (and leaves it alone when it is already open), so the tests
 * name the ACTION, not where the row happens to draw it.
 */
export function getRowAction(container: HTMLElement, name: RegExp): HTMLElement {
  const visible = within(container).queryAllByRole("button", { name });
  if (visible.length > 0) return visible[0];

  const trigger = getRowActionsTrigger(container);
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  const menu = document.getElementById(trigger.getAttribute("aria-controls") ?? "") as HTMLElement;
  return within(menu).getAllByRole("menuitem", { name })[0];
}

/** The overflow trigger of a row or card ("Más acciones para <nombre>"). */
export function getRowActionsTrigger(container: HTMLElement): HTMLElement {
  return within(container).getAllByRole("button", { name: /^más acciones para/i })[0];
}
