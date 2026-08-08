"use client";

import { useState, useEffect } from "react";
import { Loader2, Save, CheckCircle2, Stethoscope, Plus } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchFichaMedica, actualizarFichaMedica } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { ErrorState, LoadingState } from "@/components/ui";
import type { FichaMedicaEditable, TipoSangre } from "@/types/domain";
import { toUserMessage, isNotFound } from "@/lib/error-message";

interface MedicalRecordEditorProps {
  personaId: number;
}

export default function MedicalRecordEditor({ personaId }: MedicalRecordEditorProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; ficha: FichaMedicaEditable; isNew: boolean }
  >({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Load-bearing default, not cosmetic: the backend's PATCH upsert rejects
  // creating a first record without a blood type (400). `DESCONOCIDO` is a
  // valid TipoSangre, so pre-selecting it keeps that error unreachable from
  // the UI — see MedicalRecordEditor.test.tsx.
  const [tipoSangre, setTipoSangre] = useState<TipoSangre>("DESCONOCIDO");
  const [enfermedadesInput, setEnfermedadesInput] = useState("");
  const [alergias, setAlergias] = useState("");
  const [contactoEmergencia, setContactoEmergencia] = useState("");
  const [telefonoEmergencia, setTelefonoEmergencia] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSaveError(null);
    setSaveSuccess(false);

    fetchFichaMedica(personaId)
      .then((ficha) => {
        if (cancelled) return;
        setTipoSangre(ficha.tipoSangre);
        setEnfermedadesInput(ficha.enfermedades.map((e) => e.nombreEnfermedad).join(", "));
        setAlergias(ficha.alergias ?? "");
        setContactoEmergencia(ficha.contactoEmergencia ?? "");
        setTelefonoEmergencia(ficha.telefonoEmergencia ?? "");
        setState({ status: "ready", ficha, isNew: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // "No hay ficha todavía" is a 404, and that is the only thing that
        // reliably says so. This used to sniff the message for "not found" —
        // an ENGLISH substring, in a product that speaks Spanish, coming from
        // a sentence the backend was free to reword at any time. Now that the
        // translator refuses English text on principle, that check could not
        // have survived anyway; the status was always the real signal.
        if (isNotFound(error)) {
          // No medical record yet — allow creation of a new one.
          setState({ status: "ready", ficha: undefined as unknown as FichaMedicaEditable, isNew: true });
        } else {
          setState({ status: "error", message: toUserMessage(error, "No se pudo cargar la ficha médica.") });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const enfermedades = enfermedadesInput
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      await actualizarFichaMedica(personaId, {
        tipoSangre,
        enfermedades,
        alergias: alergias.trim() || undefined,
        contactoEmergencia: contactoEmergencia.trim() || undefined,
        telefonoEmergencia: telefonoEmergencia.trim() || undefined,
      });
      setSaveSuccess(true);
      setReloadToken((n) => n + 1);
      showSuccess("Ficha médica guardada correctamente.");
    } catch (error: unknown) {
      const message = toUserMessage(error, "No se pudo guardar la ficha médica.");
      setSaveError(message);
      showError(message);
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading") {
    return <LoadingState className="mt-4" label="Cargando ficha médica…" />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        className="mt-4"
        title="No se pudo cargar la ficha médica"
        message={state.message}
        onRetry={() => setReloadToken((n) => n + 1)}
      />
    );
  }

  return (
    <div className="mt-3 rounded-2xl border border-line bg-paper p-3 sm:p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
        <Stethoscope size={ICON.sm} strokeWidth={1.5} className="text-state-bad" aria-hidden="true" />
        Ficha médica
        {state.isNew && (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-2xs tracking-flat font-semibold text-blue-700">
            <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Nueva
          </span>
        )}
      </h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor={`tipo-sangre-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Tipo de sangre
          </label>
          <select
            id={`tipo-sangre-${personaId}`}
            value={tipoSangre}
            onChange={(e) => setTipoSangre(e.target.value as TipoSangre)}
            className="input-field w-full"
          >
            {["A_POSITIVO", "A_NEGATIVO", "B_POSITIVO", "B_NEGATIVO", "AB_POSITIVO", "AB_NEGATIVO", "O_POSITIVO", "O_NEGATIVO", "DESCONOCIDO"].map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <label htmlFor={`enfermedades-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Enfermedades (separadas por coma)
          </label>
          <input
            id={`enfermedades-${personaId}`}
            type="text"
            value={enfermedadesInput}
            onChange={(e) => setEnfermedadesInput(e.target.value)}
            placeholder="Ej: Asma, Diabetes"
            className="input-field w-full"
          />
          <p className="mt-1 text-2xs tracking-flat text-ink-3">
            Al guardar se reemplaza la lista completa. Dejar vacío borra todas las enfermedades.
          </p>
        </div>
        <div>
          <label htmlFor={`alergias-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Alergias
          </label>
          <input
            id={`alergias-${personaId}`}
            type="text"
            value={alergias}
            onChange={(e) => setAlergias(e.target.value)}
            className="input-field w-full"
          />
        </div>
        <div>
          <label htmlFor={`contacto-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Contacto de emergencia
          </label>
          <input
            id={`contacto-${personaId}`}
            type="text"
            value={contactoEmergencia}
            onChange={(e) => setContactoEmergencia(e.target.value)}
            className="input-field w-full"
          />
        </div>
        <div>
          <label htmlFor={`telefono-${personaId}`} className="mb-1 block text-xs font-semibold text-ink-2">
            Teléfono de emergencia
          </label>
          <input
            id={`telefono-${personaId}`}
            type="text"
            value={telefonoEmergencia}
            onChange={(e) => setTelefonoEmergencia(e.target.value)}
            className="input-field w-full"
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <Save size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          {saving ? "Guardando…" : "Guardar ficha médica"}
        </button>
        {saveError && (
          <p className="text-sm text-state-bad" role="alert">
            {saveError}
          </p>
        )}
        {saveSuccess && (
          <p className="flex items-center gap-1 text-sm text-state-ok" role="status">
            <CheckCircle2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Ficha médica guardada.
          </p>
        )}
      </div>
    </div>
  );
}
