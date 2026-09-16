/**
 * Unit tests for the shared photo-upload helper.
 *
 * The two component flows that consume it (`/profile`'s hero avatar and the
 * carnet's "Cambiar foto") are covered where they render — see
 * `ProfilePage.test.tsx` and `StudentPage.test.tsx`. What is pinned here is
 * the contract those screens now share: the allow-list, the outcome shape,
 * and the rule that a backend sentence written for the user survives while
 * anything else falls back to the caller's own wording.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import {
  FOTO_FORMATO_INVALIDO,
  FOTO_TAMANO_EXCEDIDO,
  TAMANO_MAXIMO_FOTO_BYTES,
  revisarFoto,
  subirFotoDeArchivo,
} from "@/lib/photo-upload";

/** A real `File` with the size the test needs — jsdom's is always the body's. */
function archivo({ type = "image/jpeg", size }: { type?: string; size?: number } = {}): File {
  const file = new File(["x"], "foto.jpg", { type });
  if (size !== undefined) {
    Object.defineProperty(file, "size", { value: size });
  }
  return file;
}

describe("revisarFoto", () => {
  it("accepts both allowed types and a file exactly at the size cap", () => {
    expect(revisarFoto(archivo({ type: "image/jpeg" }))).toBeNull();
    expect(revisarFoto(archivo({ type: "image/png" }))).toBeNull();
    expect(revisarFoto(archivo({ size: TAMANO_MAXIMO_FOTO_BYTES }))).toBeNull();
  });

  it("refuses every other MIME type with the shared sentence", () => {
    expect(revisarFoto(archivo({ type: "application/pdf" }))).toBe(FOTO_FORMATO_INVALIDO);
    expect(revisarFoto(archivo({ type: "image/gif" }))).toBe(FOTO_FORMATO_INVALIDO);
  });

  it("refuses a file one byte over the cap", () => {
    expect(revisarFoto(archivo({ size: TAMANO_MAXIMO_FOTO_BYTES + 1 }))).toBe(FOTO_TAMANO_EXCEDIDO);
  });
});

describe("subirFotoDeArchivo", () => {
  it("passes the file through and returns the caller's own success value", async () => {
    const file = archivo();
    const subir = vi.fn().mockResolvedValue({ fotoUrl: "https://example.test/foto.jpg" });

    await expect(subirFotoDeArchivo(file, subir, "No se pudo actualizar la foto.")).resolves.toEqual({
      status: "uploaded",
      value: { fotoUrl: "https://example.test/foto.jpg" },
    });
    expect(subir).toHaveBeenCalledWith(file);
  });

  it("turns anything thrown into the caller's fallback sentence", async () => {
    const subir = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      subirFotoDeArchivo(archivo(), subir, "No se pudo actualizar la foto."),
    ).resolves.toEqual({
      status: "failed",
      message: "No se pudo actualizar la foto.",
    });
  });

  it("keeps a backend sentence the user can act on instead of the fallback", async () => {
    // `toUserMessage` reads this 400 detail because it names the user's own
    // file. Re-throwing through the caller's `catch` would have lost the
    // status and replaced it with the generic fallback.
    const error = Object.assign(new Error("El archivo excede el tamaño máximo de 5MB"), {
      status: 400,
    });
    const subir = vi.fn().mockRejectedValue(error);

    await expect(
      subirFotoDeArchivo(archivo(), subir, "No se pudo actualizar la foto."),
    ).resolves.toEqual({
      status: "failed",
      message: "El archivo excede el tamaño máximo de 5MB",
    });
  });

  it("does not run the pre-check itself — the caller decides when to call revisarFoto", async () => {
    // The carnet upload relies on this: it sends the file and lets the
    // backend refuse it, which is the behavior it has always had.
    const subir = vi.fn().mockResolvedValue("ok");

    await expect(
      subirFotoDeArchivo(archivo({ type: "application/pdf" }), subir, "No se pudo actualizar la foto."),
    ).resolves.toEqual({ status: "uploaded", value: "ok" });
    expect(subir).toHaveBeenCalledTimes(1);
  });
});
