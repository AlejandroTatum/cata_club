/**
 * Resend a trainer's invitation while the account is still «Invitación
 * pendiente» (issue #1575). The link the trainer got expires; this sends a
 * fresh one by the same outbox, without waiting for the public cooldown.
 */

"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";
import { reenviarInvitacionEntrenador } from "@/services/api";

interface ResendInvitationSectionProps {
  personaId: number;
  trainerName: string;
}

export default function ResendInvitationSection({
  personaId,
  trainerName,
}: ResendInvitationSectionProps): React.ReactElement {
  const { showSuccess } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await reenviarInvitacionEntrenador(personaId);
      showSuccess(`Reenviamos la invitación a ${trainerName}.`);
    } catch (err: unknown) {
      setError(toUserMessage(err, "No se pudo reenviar la invitación. Intenta nuevamente."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs text-ink-3">
        {trainerName} todavía no creó su contraseña. Si el enlace del correo venció, envía uno nuevo.
      </p>
      <button
        type="button"
        onClick={() => void handleResend()}
        disabled={loading}
        className={`${buttonClasses("secondary", "sm")} mt-2`}
      >
        {loading ? (
          <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
        ) : (
          <Send size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        )}
        {loading ? "Enviando…" : "Reenviar invitación"}
      </button>
      {error && (
        <p className="mt-2 text-xs text-state-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
