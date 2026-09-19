import { describe, expect, it, vi } from "vitest";
import { runCleanupWithoutMasking } from "../finally-guard";

describe("runCleanupWithoutMasking", () => {
  it("no interviene cuando la limpieza no falla", async () => {
    const onCleanupFailure = vi.fn();
    const cleanup = vi.fn().mockResolvedValue(undefined);

    await runCleanupWithoutMasking(undefined, cleanup, onCleanupFailure);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure).not.toHaveBeenCalled();
  });

  it("relanza la falla de limpieza cuando NO hay error primario en vuelo", async () => {
    const onCleanupFailure = vi.fn();
    const cleanupError = new Error("no se pudo reautenticar como admin");
    const cleanup = vi.fn().mockRejectedValue(cleanupError);

    await expect(runCleanupWithoutMasking(undefined, cleanup, onCleanupFailure)).rejects.toBe(
      cleanupError,
    );
    expect(onCleanupFailure).not.toHaveBeenCalled();
  });

  it("REGRESIÓN R2-003/R3-cleanup-expect-masks-primary-failure: no reemplaza el error primario con la falla de limpieza", async () => {
    const onCleanupFailure = vi.fn();
    const primaryError = new Error("la cobertura esperada no avanzó");
    const cleanupError = new Error("no se pudo reautenticar como admin para la limpieza: 401");
    const cleanup = vi.fn().mockRejectedValue(cleanupError);

    // Sin este guard, un `finally` que hace `await cleanup()` directo
    // relanzaría `cleanupError` y el `primaryError` (el diff real que el
    // test quería reportar) se perdería sin dejar rastro.
    await expect(runCleanupWithoutMasking(primaryError, cleanup, onCleanupFailure)).resolves.toBeUndefined();
    expect(onCleanupFailure).toHaveBeenCalledExactlyOnceWith(cleanupError);
  });
});
