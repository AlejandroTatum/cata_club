import { describe, expect, it } from "vitest";
import {
  IMAGE_SERVICE_UNAVAILABLE,
  imageFileError,
  uploadErrorMessage,
} from "../uploadError";

const fail = (message: string, status: number): Error =>
  Object.assign(new Error(message), { status });
const GENERIC = "No se pudo subir el logo. Intenta de nuevo.";

describe("uploadErrorMessage", () => {
  it.each([500, 502, 503, 504])(
    "reports %s as a service outage, not a file problem",
    (status) => {
      const text = uploadErrorMessage(
        fail("ServicioNoDisponible", status),
        GENERIC,
      );
      expect(text).toBe(IMAGE_SERVICE_UNAVAILABLE);
      expect(text).not.toMatch(/5 MB|JPG|PNG/);
    },
  );
  it("shows the backend's validation message for 400/422", () => {
    expect(
      uploadErrorMessage(
        fail("La imagen no puede superar 5 MB.", 400),
        GENERIC,
      ),
    ).toBe("La imagen no puede superar 5 MB.");
    expect(uploadErrorMessage(fail("Formato no permitido", 422), GENERIC)).toBe(
      "Formato no permitido",
    );
  });
  it("falls back to a neutral file message when the detail is not for people", () => {
    expect(uploadErrorMessage(fail("archivo_invalido", 400), GENERIC)).toBe(
      "Revisa el archivo e intenta de nuevo.",
    );
  });
  it("explains 413 and 415 by what the status itself says", () => {
    expect(uploadErrorMessage(fail("", 413), GENERIC)).toMatch(
      /supera el tamaño/,
    );
    expect(uploadErrorMessage(fail("unsupported", 415), GENERIC)).toMatch(
      /JPG o PNG/,
    );
  });
  it("maps network, session and unknown failures", () => {
    expect(
      uploadErrorMessage(new TypeError("Failed to fetch"), GENERIC),
    ).toMatch(/conexión/);
    expect(uploadErrorMessage(fail("x", 401), GENERIC)).toMatch(/sesión/);
    expect(uploadErrorMessage(fail("x", 403), GENERIC)).toMatch(/permisos/);
    expect(uploadErrorMessage(fail("x", 404), GENERIC)).toBe(GENERIC);
    expect(uploadErrorMessage(new Error("boom"), GENERIC)).toBe(GENERIC);
  });
});

describe("imageFileError", () => {
  it("blames the size only for a real oversize file", () => {
    expect(
      imageFileError(
        new File(["x"], "a.png", { type: "image/png" }),
        "El logo",
      ),
    ).toBeNull();
    expect(
      imageFileError(
        new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], "a.png", {
          type: "image/png",
        }),
        "El logo",
      ),
    ).toMatch(/supera el límite de 5 MB/);
    expect(
      imageFileError(
        new File(["x"], "a.gif", { type: "image/gif" }),
        "El logo",
      ),
    ).toBe("El logo debe ser un archivo JPG o PNG.");
  });
});
