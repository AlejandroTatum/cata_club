/**
 * Fills a `BirthDateField`'s three Día/Mes/Año controls from an ISO
 * `YYYY-MM-DD` string — the DOM-level replacement for the single
 * `fireEvent.change` every wizard test used on the native
 * `<input type="date">` before issue #853 replaced it with a guided field
 * (some mobile browsers' native picker only steps month by month, so a
 * decades-old birth date could take roughly 480 taps).
 *
 * `fieldId` is the field's own id — `enrollFieldId("fechaNacimiento")`,
 * `addDependentFieldId("fechaNacimiento")`, `crearCuentaFieldId("fechaNacimiento")`
 * — the same id every one of these wizards already declares for the field,
 * now the `<fieldset>`'s id rather than a single `<input>`'s.
 */

import { fireEvent } from "@testing-library/react";
import { birthDatePartIds } from "@/components/wizard-fields";

function partElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing birth-date part: ${id}`);
  return el;
}

export function fillBirthDate(fieldId: string, iso: string): void {
  const [year, month, day] = iso.split("-");
  const ids = birthDatePartIds(fieldId);
  fireEvent.change(partElement(ids.day), { target: { value: day } });
  fireEvent.change(partElement(ids.month), { target: { value: month } });
  fireEvent.change(partElement(ids.year), { target: { value: year } });
}
