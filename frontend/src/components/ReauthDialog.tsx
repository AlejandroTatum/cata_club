/**
 * ReauthDialog — asks an administrator to re-enter their password (#1653, S5).
 *
 * Role changes require a recent password step-up; when the backend answers
 * `reautenticacion_requerida`, `useReauthRetry` opens this dialog. It is a
 * native `<dialog>` shown with `showModal()` on purpose: the callers sit inside
 * another native modal (the member editor), which lives in the browser's top
 * layer, so only another modal opened after it can be drawn above it and keep
 * Tab focus trapped.
 *
 * The password lives in this component's state while the dialog is open and is
 * gone when it closes — mounting only while `open` is what clears it. It is
 * handed to `onSubmit` and nowhere else: not persisted, not logged.
 */

"use client";

import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { toUserMessage } from "@/lib/error-message";

export interface ReauthDialogProps {
  open: boolean;
  /** Verifies the password. Rejects with the error to show; resolves when it was accepted. */
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
}

function ReauthDialogBody({ onSubmit, onCancel }: Omit<ReauthDialogProps, "open">): React.ReactElement {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const inputId = `${baseId}-password`;
  const errorId = `${baseId}-error`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    inputRef.current?.focus();

    // Escape belongs to THIS dialog: the editor underneath listens for it on
    // `document` and would close too, discarding the change being confirmed.
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    }
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      mountedRef.current = false;
      dialog.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onCancel]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    if (!password) {
      setError("Ingresa tu contraseña.");
      inputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (failure: unknown) {
      if (!mountedRef.current) return;
      setError(toUserMessage(failure, "No se pudo confirmar tu contraseña."));
      setPassword("");
      setSubmitting(false);
      inputRef.current?.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Escape is handled above; stop the browser closing it on its own.
        event.preventDefault();
      }}
      className="card m-auto w-full max-w-sm p-6 backdrop:bg-cata-black/40"
    >
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="grid gap-4">
        <div>
          <h2 id={titleId} className="text-base font-semibold text-ink">
            Confirma tu contraseña
          </h2>
          <p id={descriptionId} className="mt-2 text-sm text-ink-3-strong">
            Por seguridad, para cambiar roles necesitamos que vuelvas a ingresar tu contraseña. La
            confirmación vale por 10 minutos.
          </p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={inputId} className="text-sm font-semibold text-ink">
            Contraseña
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="password"
            value={password}
            autoComplete="current-password"
            disabled={submitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setPassword(event.target.value);
              setError(null);
            }}
            className={`input-field ${error ? "border-state-bad" : ""}`}
          />
          {error && (
            <p id={errorId} role="alert" className="text-xs font-semibold text-state-bad">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? "Verificando…" : "Confirmar"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export default function ReauthDialog({ open, onSubmit, onCancel }: ReauthDialogProps): React.ReactElement | null {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<ReauthDialogBody onSubmit={onSubmit} onCancel={onCancel} />, document.body);
}
