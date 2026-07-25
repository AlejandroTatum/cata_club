/**
 * AgeUpConfirmation — modal for a minor-turned-adult to confirm they want
 * to unlink from their legal representative (independizarse).
 *
 * Requires typing the account password and ticking a confirmation checkbox.
 * Follows the ConfirmDialog focus-trap pattern (Escape cancels, Tab cycles).
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

export interface AgeUpConfirmationProps {
  open: boolean;
  onConfirm: (contrasenia: string) => Promise<void>;
  onCancel: () => void;
}

export default function AgeUpConfirmation({
  open,
  onConfirm,
  onCancel,
}: AgeUpConfirmationProps): React.ReactElement | null {
  const [contrasenia, setContrasenia] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  const canSubmit = contrasenia.length >= 8 && confirmed && !loading;

  useEffect(() => {
    if (!open) return;

    triggerElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [confirmButtonRef.current, cancelButtonRef.current].filter(
        (el): el is HTMLButtonElement => el !== null,
      );
      if (focusable.length === 0) return;

      event.preventDefault();
      const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex =
        (currentIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerElementRef.current?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await onConfirm(contrasenia);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ocurrió un error inesperado.");
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-cata-black/40 px-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="age-up-dialog-title"
        onClick={(event) => event.stopPropagation()}
        className="card w-full max-w-sm p-6"
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={18} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
          <h2 id="age-up-dialog-title" className="text-base font-semibold text-cata-red">
            Independizarse del representante
          </h2>
        </div>
        <p className="text-sm leading-relaxed text-cata-text/65">
          Al independizarte, te desvincularás de tu representante legal y serás
          responsable de tu propia cuenta. Podrás inscribir dependientes y gestionar
          tus pagos directamente.
        </p>

        <div className="mt-4">
          <label htmlFor="age-up-password" className="text-xs font-medium text-cata-text/45">
            Confirma tu contraseña
          </label>
          <input
            id="age-up-password"
            type="password"
            value={contrasenia}
            onChange={(e) => setContrasenia(e.target.value)}
            placeholder="Tu contraseña actual"
            className="mt-1 w-full rounded-xl border border-cata-border bg-cata-surface px-3 py-2 text-sm text-cata-text placeholder-cata-text/30 focus:border-cata-red/40 focus:outline-none focus:ring-2 focus:ring-cata-red/10"
            autoComplete="current-password"
          />
        </div>

        <label className="mt-3 flex items-start gap-2 text-xs text-cata-text/65">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-cata-border text-cata-red focus:ring-cata-red/20"
          />
          <span>
            Entiendo que esta acción es permanente y me desvincula de mi representante legal actual.
          </span>
        </label>

        {error && (
          <p className="mt-3 text-xs text-cata-red">{error}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="btn-secondary"
          >
            Cancelar
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-primary bg-cata-red hover:bg-cata-red/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Procesando..." : "Independizarme"}
          </button>
        </div>
      </div>
    </div>
  );
}
