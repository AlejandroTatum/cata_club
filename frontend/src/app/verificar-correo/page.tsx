/**
 * Verify Email Page — confirms an address using the token from the email link
 * (issue #790).
 *
 * Expects `?token=xxx` in the URL. Sibling of `/reset-password`: same
 * `AuthShell` composition, same three states (missing/dead token, working,
 * done), and the same arrival story — the visitor got here from a mail
 * client, so there is no history to go back to and every state exits to
 * `/login`.
 *
 * It verifies on mount rather than behind a "Confirm" button. The click that
 * expresses intent already happened, in the email; a second button would only
 * add a step to a screen whose entire job is to say "done".
 *
 * The dead-link state offers the resend form inline instead of sending the
 * visitor somewhere else, because an expired link is the single most likely
 * way to land here and `/reset-password` already learned that a dead end is
 * the wrong answer to it.
 */

"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Mail } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { reenviarVerificacionCorreo, verificarCorreo } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";
import AuthShell, {
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
} from "@/components/auth/AuthShell";
import { Button, buttonClasses } from "@/components/ui";
import { toUserMessage } from "@/lib/error-message";

/** Carried below the card on every state, so the lifetime is stated once. */
const LINK_LIFETIME_NOTE = "Los enlaces de verificación duran 24 horas.";

type Estado = "verificando" | "verificado" | "enlace_invalido";

/**
 * The resend form, shown inside the dead-link card.
 *
 * On success it does NOT claim the email was sent: the backend answers the
 * same way whether or not the address is registered, so the only honest thing
 * to show is the message it returned, verbatim.
 */
function FormularioReenvio(): React.ReactElement {
  const toast = useToast();
  const [correo, setCorreo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!correo.trim()) {
      toast.showError("Ingrese su correo electrónico.");
      return;
    }

    setEnviando(true);
    try {
      const respuesta = await reenviarVerificacionCorreo(correo.trim());
      setMensaje(respuesta.mensaje);
    } catch (err) {
      toast.showError(
        toUserMessage(err, "No se pudo procesar la solicitud. Intente nuevamente."),
      );
    } finally {
      setEnviando(false);
    }
  }

  if (mensaje) {
    return (
      <p role="status" className="text-sm leading-relaxed text-ink-2">
        {mensaje}
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="correo" className={AUTH_LABEL_CLASSES}>
          Correo electrónico <span aria-hidden="true" className="text-state-bad">*</span>
        </label>
        <div className="relative">
          <Mail
            size={ICON.sm}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
            aria-hidden="true"
          />
          <input
            type="email"
            id="correo"
            name="correo"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="correo@ejemplo.com"
            required
            disabled={enviando}
            className={`${AUTH_INPUT_CLASSES} pl-9`}
          />
        </div>
      </div>
      <Button type="submit" variant="primary" disabled={enviando} className="w-full">
        {enviando ? "Enviando…" : "Enviar un enlace nuevo"}
      </Button>
    </form>
  );
}

function VerificarCorreoContent(): React.ReactElement {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  // #1196: a visitor who already has a session (mid-activation, in another
  // tab or device) is sent to the activation gate instead of "Iniciar
  // sesión" — that link would only bounce them right back here.
  const { isAuthenticated } = useAuth();
  const [estado, setEstado] = useState<Estado>(token ? "verificando" : "enlace_invalido");
  // React 18 mounts effects twice in development StrictMode; without this the
  // page would POST the same token twice on every local run.
  const yaIntentado = useRef(false);

  const verificar = useCallback(async (valor: string) => {
    try {
      await verificarCorreo(valor);
      setEstado("verificado");
    } catch {
      // The backend answers every dead-link case identically on purpose, so
      // there is nothing to branch on and nothing more to tell the visitor
      // than that this link no longer works.
      setEstado("enlace_invalido");
    }
  }, []);

  useEffect(() => {
    if (!token || yaIntentado.current) return;
    yaIntentado.current = true;
    void verificar(token);
  }, [token, verificar]);

  if (estado === "verificando") {
    return (
      <AuthShell title="Verificando su correo" note={LINK_LIFETIME_NOTE} backHref="/login" eyebrow="Acceso al club">
        <p role="status" className="py-2 text-center text-sm leading-relaxed text-ink-2">
          Un momento, estamos confirmando su dirección…
        </p>
      </AuthShell>
    );
  }

  if (estado === "verificado") {
    return (
      <AuthShell title="Correo verificado" backHref="/login" eyebrow="Acceso al club">
        <div className="flex flex-col items-center gap-2.5 py-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-state-ok-bg">
            <CheckCircle2 size={ICON.lg} className="text-state-ok" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-ink-2">
            Su dirección quedó confirmada. Acérquese al club o escríbanos por
            WhatsApp para registrar la inscripción y el primer pago: el club
            lo valida y ahí se activa la membresía.
          </p>
        </div>
        {isAuthenticated ? (
          <Link href="/login/activacion" className={buttonClasses("primary", "md", "w-full")}>
            Continuar con mi activación
          </Link>
        ) : (
          <Link href="/login" className={buttonClasses("primary", "md", "w-full")}>
            Iniciar sesión
          </Link>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Enlace no válido"
      subtitle="Pida uno nuevo con su correo"
      note={LINK_LIFETIME_NOTE}
      backHref="/login"
      eyebrow="Acceso al club"
    >
      <div className="flex flex-col items-center gap-2.5 py-2 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-state-bad-bg">
          <AlertCircle size={ICON.lg} className="text-state-bad" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <p className="text-sm leading-relaxed text-ink-2">
          El enlace de verificación ya no sirve. Puede pedir uno nuevo desde
          esta misma pantalla.
        </p>
      </div>
      <FormularioReenvio />
    </AuthShell>
  );
}

export default function VerificarCorreoPage(): React.ReactElement {
  return (
    <Suspense>
      <VerificarCorreoContent />
    </Suspense>
  );
}
