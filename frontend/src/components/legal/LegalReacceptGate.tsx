/**
 * LegalReacceptGate — blocks the app until an authenticated account accepts
 * the current version of the terms (S8).
 *
 * The backend decides: `GET /api/auth/consentimiento-legal` says whether the
 * account's latest accepted version is older than the current one, and
 * `POST .../aceptar` records the acceptance for the token's own account. This
 * component only asks, shows the SAME terms the public page and the
 * enrolment review render (`LegalDocumentProse`), and posts the decision.
 *
 * Mounted once in `AuthProviderWrapper`, above every route. Unlike
 * `LegalReviewDialog` it has no way to be dismissed: the only exits are
 * accepting and signing out. A failed status check does not lock anyone out
 * (the backend keeps the pending state, so the next session check asks again).
 */

"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import Button from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { useModalFocusTrap } from "@/lib/focus-trap";
import { LEGAL_REVIEW_DOCUMENTS, LegalDocumentProse } from "@/components/legal/LegalReviewDialog";

const STATUS_URL = "/api/auth/consentimiento-legal";
const ACCEPT_URL = "/api/auth/consentimiento-legal/aceptar";

interface LegalStatus {
  pendiente: boolean;
}

async function readPending(url: string, init?: RequestInit): Promise<boolean | null> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) return null;
    return ((await response.json()) as LegalStatus).pendiente;
  } catch {
    return null;
  }
}

export default function LegalReacceptGate(): ReactElement | null {
  const { isAuthenticated, session, logout } = useAuth();
  const userId = session?.user.id ?? null;
  const [pending, setPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect((): undefined | (() => void) => {
    if (!isAuthenticated) {
      setPending(false);
      return undefined;
    }
    let cancelled = false;
    void readPending(STATUS_URL).then((value) => {
      if (!cancelled && value !== null) setPending(value);
    });
    return (): void => {
      cancelled = true;
    };
  }, [isAuthenticated, userId]);

  useModalFocusTrap({ open: pending, onClose: () => undefined, panelRef, initialFocusRef: acceptRef });

  const accept = useCallback(async (): Promise<void> => {
    setSubmitting(true);
    setFailed(false);
    const value = await readPending(ACCEPT_URL, { method: "POST" });
    setSubmitting(false);
    if (value === null || value) {
      setFailed(true);
      return;
    }
    setPending(false);
  }, []);

  if (!pending) return null;

  const document_ = LEGAL_REVIEW_DOCUMENTS.terminos;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-cata-black/60 px-4 pt-4 sm:items-center sm:pb-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-reaccept-title"
        className="card relative flex max-h-[85dvh] w-full max-w-measure flex-col overflow-hidden p-0 shadow-elevated"
      >
        <header className="flex-none border-b border-line px-page pb-section pt-page">
          <p className="mb-4 text-xs font-extrabold uppercase tracking-caps-wide text-cata-red-dark">
            Actualización de términos
          </p>
          <h2
            id="legal-reaccept-title"
            className="text-balance font-display text-lg uppercase leading-crisp tracking-flat text-cata-text sm:text-xl"
          >
            {document_.title}
          </h2>
          <p className="mt-3 text-sm text-cata-text">
            Actualizamos los términos. Revísalos y acéptalos para seguir usando Cata Club.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-page py-section">
          <LegalDocumentProse
            blocks={document_.blocks}
            headingLevel={3}
            className="space-y-4 leading-snug text-cata-text"
          />
        </div>

        <footer className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-line bg-sunken px-page py-section">
          {failed && (
            <p role="alert" className="w-full text-sm font-semibold text-state-error">
              No pudimos registrar tu aceptación. Inténtalo de nuevo.
            </p>
          )}
          <Button variant="secondary" onClick={() => void logout()} disabled={submitting}>
            Cerrar sesión
          </Button>
          <Button ref={acceptRef} variant="primary" onClick={() => void accept()} disabled={submitting}>
            Acepto los términos
          </Button>
        </footer>
      </div>
    </div>
  );
}
