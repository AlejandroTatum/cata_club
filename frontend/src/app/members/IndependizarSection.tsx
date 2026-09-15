/**
 * Independizar a un adulto representado — comando PRESENCIAL del mostrador
 * (issue #1137).
 *
 * El autoservicio anterior (la persona confirmaba su propia contraseña para
 * "independizarse" desde `/student`) se jubiló: el backend ahora exige un
 * ADMINISTRADOR con la persona enfrente (`POST /personas/{id}/independizar`,
 * `backend/app/presentacion/routers/personas_router.py`). Este formulario es
 * la única puerta que queda para ese comando — no hay ruta de autoservicio
 * que lo reemplace.
 *
 * Solo tiene sentido para una persona representada que YA es adulta:
 * `MemberEditDialog` no monta esta sección para un `isMinorStudent` — el
 * backend rechaza a un menor (`independizar_presencial`'s own doc comment),
 * así que ofrecerla ahí sería un callejón sin salida garantizado.
 */

"use client";

import { useState } from "react";
import { Loader2, UserMinus } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { independizarPersona } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import { PASSWORD_MIN_LENGTH } from "@/lib/identity-validation";

interface IndependizarSectionProps {
  personaId: number;
  personaNombreCompleto: string;
  /** Refetch the member list — once independence commits, this row is no longer represented. */
  onIndependizado: () => void;
}

export default function IndependizarSection({
  personaId,
  personaNombreCompleto,
  onIndependizado,
}: IndependizarSectionProps): React.ReactElement {
  const { showSuccess } = useToast();
  const [open, setOpen] = useState(false);
  const [correo, setCorreo] = useState("");
  const [contrasenia, setContrasenia] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [evidenciaIdentidad, setEvidenciaIdentidad] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!correo || !contrasenia || !evidenciaIdentidad.trim()) {
      return "El correo, la contraseña y la evidencia del trámite son obligatorios.";
    }
    if (contrasenia.length < PASSWORD_MIN_LENGTH) {
      return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
    }
    if (contrasenia !== confirmacion) {
      return "Las dos contraseñas no coinciden.";
    }
    return null;
  }

  async function handleSubmit(): Promise<void> {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await independizarPersona(
        personaId,
        { correo, contrasenia, evidenciaIdentidad: evidenciaIdentidad.trim() },
        crypto.randomUUID(),
      );
      showSuccess(`Se creó la cuenta de ${personaNombreCompleto}. Ya no depende de su representante.`);
      setOpen(false);
      onIndependizado();
    } catch (err: unknown) {
      setError(toUserMessage(err, "No se pudo completar la independencia de esta persona."));
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses("secondary", "sm")}>
        <UserMinus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        Independizar
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-ctl border border-line bg-sunken p-3">
      <p className="text-xs text-ink-3">
        Trámite presencial: confirme la identidad de {personaNombreCompleto} en el mostrador y
        establezca sus credenciales. Deja de depender de su representante y podrá iniciar sesión
        con lo que registre acá.
      </p>
      <label className="block text-sm font-semibold text-ink-2">
        Correo
        <input
          type="email"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          className="mt-0.5 h-ctl w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink"
          placeholder="correo@ejemplo.com"
        />
      </label>
      <label className="block text-sm font-semibold text-ink-2">
        Contraseña inicial
        <input
          type="password"
          value={contrasenia}
          onChange={(e) => setContrasenia(e.target.value)}
          className="mt-0.5 h-ctl w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink"
          autoComplete="new-password"
        />
      </label>
      <label className="block text-sm font-semibold text-ink-2">
        Confirmar contraseña
        <input
          type="password"
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          className="mt-0.5 h-ctl w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink"
          autoComplete="new-password"
        />
      </label>
      <label className="block text-sm font-semibold text-ink-2">
        Evidencia del trámite
        <input
          type="text"
          value={evidenciaIdentidad}
          onChange={(e) => setEvidenciaIdentidad(e.target.value)}
          maxLength={500}
          className="mt-0.5 h-ctl w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink"
          placeholder="Cédula verificada en el mostrador"
        />
      </label>
      {error && (
        <p className="text-xs text-state-bad" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading}
          className={buttonClasses("primary", "sm")}
        >
          {loading ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <UserMinus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          {loading ? "Procesando…" : "Confirmar independencia"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClasses("secondary", "sm")}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
