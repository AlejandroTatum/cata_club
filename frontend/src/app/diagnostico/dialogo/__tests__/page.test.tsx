/**
 * Candado de la página de diagnóstico (temporal, ver el comentario de
 * cabecera de `page.tsx`): lo único que importa es que mida el diálogo REAL,
 * no una réplica. Si alguien copia a mano las clases de
 * `NATIVE_DIALOG_SHELL_CLASS` / `NATIVE_DIALOG_BODY_CLASS` en vez de
 * importarlas, la página deja de estar acoplada al diálogo que rompe en
 * WebKit y cualquier arreglo futuro de esas constantes queda sin medir aquí.
 *
 * Dos capas: (1) un chequeo estático sobre el código fuente — el mismo
 * patrón que `types/__tests__/tipo-notificacion-parity.test.ts` — que
 * confirma el import real y que no hay una segunda definición local de esos
 * nombres; (2) un render que confirma que el `<dialog>` y el cuerpo
 * terminan con exactamente esas clases en el DOM.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import DiagnosticoDialogoPage from "../page";
import { NATIVE_DIALOG_SHELL_CLASS, NATIVE_DIALOG_BODY_CLASS } from "@/app/members/useNativeDialog";

const SOURCE_PATH = join(__dirname, "..", "page.tsx");

afterEach(cleanup);

describe("página de diagnóstico — usa las constantes importadas, no strings propios", () => {
  it("importa NATIVE_DIALOG_SHELL_CLASS, NATIVE_DIALOG_BODY_CLASS y useNativeDialog desde @/app/members/useNativeDialog", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    const importMatch = source.match(
      /import\s*\{([^}]*)\}\s*from\s*"@\/app\/members\/useNativeDialog";/,
    );
    expect(importMatch).not.toBeNull();
    const importedNames = importMatch![1].split(",").map((name) => name.trim());
    expect(importedNames).toEqual(
      expect.arrayContaining(["NATIVE_DIALOG_SHELL_CLASS", "NATIVE_DIALOG_BODY_CLASS", "useNativeDialog"]),
    );
  });

  it("no redeclara NATIVE_DIALOG_SHELL_CLASS ni NATIVE_DIALOG_BODY_CLASS como strings propios", () => {
    const source = readFileSync(SOURCE_PATH, "utf-8");
    // Una copia a mano se vería como una asignación local a ese nombre —
    // la única aparición válida es la del import ya verificado arriba.
    expect(source).not.toMatch(/const\s+NATIVE_DIALOG_SHELL_CLASS\s*=/);
    expect(source).not.toMatch(/const\s+NATIVE_DIALOG_BODY_CLASS\s*=/);
    // Tampoco un literal hardcodeado con el inicio reconocible de la clase
    // del shell real (empezaría el mismo string sin pasar por el import).
    expect(source).not.toMatch(/"fixed inset-x-0 top-\[var\(--dialog-viewport-top/);
  });

  it("el <dialog> renderizado usa exactamente NATIVE_DIALOG_SHELL_CLASS", async () => {
    render(<DiagnosticoDialogoPage />);

    const dialog = await waitFor(() => screen.getByRole("dialog", { hidden: true }));
    expect(dialog.className).toBe(NATIVE_DIALOG_SHELL_CLASS);
  });

  it("el cuerpo scrollable usa exactamente NATIVE_DIALOG_BODY_CLASS", async () => {
    render(<DiagnosticoDialogoPage />);

    const dialog = await waitFor(() => screen.getByRole("dialog", { hidden: true }));
    const body = dialog.querySelector(`.${NATIVE_DIALOG_BODY_CLASS.split(" ")[0]}`) as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.className).toBe(NATIVE_DIALOG_BODY_CLASS);
  });
});
