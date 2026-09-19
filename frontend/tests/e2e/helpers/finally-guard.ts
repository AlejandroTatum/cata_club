/**
 * Corre `cleanup` dentro de un `finally` sin dejar que una falla de higiene
 * reemplace el error primario del `try` (revisión nativa de #1352,
 * R2-003/R3-cleanup-expect-masks-primary-failure): en JavaScript, una
 * excepción lanzada DENTRO de un `finally` reemplaza la que ya estaba en
 * vuelo, así que un `expect()` de limpieza que falla justo cuando la
 * aserción real también falló (p. ej. el backend caído tumba a ambas) deja
 * el mensaje equivocado y esconde el diff que sí importa.
 *
 * `primaryError` es lo que el `try` ya dejó en vuelo (`undefined` si nada
 * falló). Si `cleanup` también falla: cuando HAY un error primario, la
 * falla de limpieza se reporta aparte (`onCleanupFailure`) en vez de
 * reemplazarlo; cuando NO lo hay, se relanza tal cual, porque ahí sí es la
 * única falla que el test tiene para reportar.
 */
export async function runCleanupWithoutMasking(
  primaryError: unknown,
  cleanup: () => Promise<void>,
  onCleanupFailure: (cleanupError: unknown) => void,
): Promise<void> {
  try {
    await cleanup();
  } catch (cleanupError) {
    if (primaryError === undefined) {
      throw cleanupError;
    }
    onCleanupFailure(cleanupError);
  }
}
