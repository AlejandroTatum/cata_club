"use client";

import { useState, type FormEvent } from "react";

export interface ReportProblemDialogProps {
  onClose: () => void;
  requestId?: string;
}

/** Screenshots are NEVER captured; only a user-selected file is transmitted. */
export default function ReportProblemDialog({ onClose, requestId }: ReportProblemDialogProps): React.ReactElement {
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!description.trim() || (screenshot && !consent)) return;
    setSending(true);
    setError("");
    const form = new FormData();
    form.set("descripcion", description.trim());
    form.set("ruta", window.location.pathname);
    if (screenshot) {
      form.set("captura", screenshot);
      form.set("consentimiento_captura", "true");
    }
    try {
      const response = await fetch("/api/reportes-error", {
        method: "POST", body: form,
        ...(requestId ? { headers: { "X-Request-ID": requestId } } : {}),
      });
      if (!response.ok) throw new Error("No se pudo enviar el reporte. Inténtelo de nuevo.");
      setSent(true);
    } catch {
      setError("No se pudo enviar el reporte. Inténtelo de nuevo.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <section role="dialog" aria-modal="true" aria-label="Reportar un problema" className="w-full max-w-lg rounded-xl bg-cata-surface p-6 text-cata-text shadow-elevated">
        <h2 className="text-xl font-semibold">Reportar un problema</h2>
        {sent ? (
          <div className="mt-4">
            <p>Gracias. El club recibió su reporte.</p>
            <button type="button" onClick={onClose} className="mt-4 rounded-lg bg-cata-red px-4 py-2 text-white">Cerrar</button>
          </div>
        ) : (
          <form onSubmit={(event) => { void submit(event); }} className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-2">¿Qué ocurrió?
              <textarea required maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-32 rounded-lg border border-cata-border p-3" />
            </label>
            <label className="flex flex-col gap-2">Captura opcional (PNG, JPEG o WebP, hasta 2 MB)
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setScreenshot(event.target.files?.[0] ?? null); setConsent(false); }} />
            </label>
            {screenshot && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>La captura puede contener datos personales y solo la administración del club la verá. Acepto enviarla.</span>
              </label>
            )}
            {error && <p role="alert" className="text-cata-red">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-cata-border px-4 py-2">Cancelar</button>
              <button type="submit" disabled={sending || !description.trim() || Boolean(screenshot && (!consent || screenshot.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(screenshot.type)))} className="rounded-lg bg-cata-red px-4 py-2 text-white disabled:opacity-50">{sending ? "Enviando…" : "Enviar reporte"}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
