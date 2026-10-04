"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Camera, CheckCircle2, X } from "lucide-react";
import { Button, FileDropZone } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { CAPTURE_TYPES, MAX_CAPTURE_BYTES } from "./report-problem/capture";

const MAX_DESCRIPTION = 2000;

/** What the page grabbed before the dialog opened; `file` is only a draft. */
export interface InitialCapture { file: File | null; failed: boolean }

export interface ReportProblemDialogProps {
  onClose: () => void;
  requestId?: string;
  capture?: InitialCapture;
}

function captureError(file: File): string {
  if (!CAPTURE_TYPES.includes(file.type)) return "Usa una imagen PNG, JPEG o WebP.";
  if (file.size > MAX_CAPTURE_BYTES) return "La captura supera los 2 MB.";
  return "";
}

/**
 * The automatic capture is only a DRAFT: nothing is transmitted unless the
 * person ticks the consent box (issue #1401). Removing or replacing the file
 * resets that consent.
 */
export default function ReportProblemDialog({ onClose, requestId, capture }: ReportProblemDialogProps): React.ReactElement {
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(capture?.file ?? null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [sending, setSending] = useState(false);
  const [trackingId, setTrackingId] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [route] = useState(() => (typeof window === "undefined" ? "" : window.location.pathname));
  const [browser] = useState(() => (typeof navigator === "undefined" ? "" : navigator.userAgent));

  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const isAuto = Boolean(screenshot && screenshot === capture?.file);
  const previewUrl = useMemo(() => (screenshot ? URL.createObjectURL(screenshot) : null), [screenshot]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!sent) return;
    doneRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sent, onClose]);

  function pickFile(file: File | null): void {
    setConsent(false);
    if (!file) { setScreenshot(null); setFileError(""); return; }
    const problem = captureError(file);
    setFileError(problem);
    if (!problem) setScreenshot(file);
  }

  const attached = Boolean(screenshot && consent);
  const blocked = sending || !description.trim() || Boolean(screenshot && (!consent || captureError(screenshot)));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!description.trim() || (screenshot && !consent)) return;
    setSending(true);
    setError("");
    const form = new FormData();
    form.set("descripcion", description.trim());
    form.set("ruta", route);
    if (screenshot) {
      form.set("captura", screenshot);
      form.set("consentimiento_captura", "true");
    }
    try {
      const response = await fetch("/api/reportes-error", {
        method: "POST", body: form,
        ...(requestId ? { headers: { "X-Request-ID": requestId } } : {}),
      });
      if (!response.ok) throw new Error("send failed");
      const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
      setTrackingId(typeof body?.id === "number" ? body.id : null);
      setSent(true);
    } catch {
      setError("No se pudo enviar el reporte. Inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div role="presentation" data-report-ignore className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 sm:items-center sm:p-4">
      <section role="dialog" aria-modal="true" aria-label="Reportar un problema" className={`flex h-full w-full ${sent ? "max-w-md" : "max-w-5xl"} flex-col overflow-hidden bg-cata-surface text-cata-text shadow-elevated sm:h-auto sm:max-h-[92vh] sm:rounded-xl`}>
        <header className="flex items-center justify-between border-b border-cata-border px-5 py-3">
          <h2 className="text-xl font-semibold">Reportar un problema</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-2 hover:bg-sunken"><X size={ICON.base} aria-hidden="true" /></button>
        </header>
        {sent ? (
          <div className="flex flex-col items-center gap-4 p-8 text-center">
            <div role="status" className="flex flex-col items-center gap-2">
              <CheckCircle2 size={ICON.lg} className="text-state-ok" aria-hidden="true" />
              <h3 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Reporte enviado</h3>
              <p>El club ya lo recibió y lo va a revisar.</p>
            </div>
            {trackingId !== null && (
              <div className="flex flex-col items-center gap-1">
                <span className="rounded-full bg-sunken px-4 py-1 text-lg font-bold">#{trackingId}</span>
                <p className="text-sm text-ink-2">Guarda este código si necesitas consultarlo</p>
              </div>
            )}
            <Button ref={doneRef} type="button" variant="primary" onClick={onClose}>Cerrar</Button>
          </div>
        ) : (
          <form onSubmit={(event) => { void submit(event); }} className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-5 lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-4">
                <label className="flex flex-col gap-2 text-sm font-semibold">¿Qué ocurrió?
                  <textarea required maxLength={MAX_DESCRIPTION} value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-32 rounded-lg border border-cata-border p-3 text-base font-normal" />
                  <span className="text-xs font-normal text-ink-2" aria-live="polite">{description.length}/{MAX_DESCRIPTION}</span>
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold">¿Dónde ocurrió?
                  <input readOnly value={route} className="rounded-lg border border-cata-border bg-sunken p-2 font-mono text-sm font-normal" />
                </label>
                {isAuto ? (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="report-capture" className="text-sm font-semibold">Captura opcional (PNG, JPEG o WebP, hasta 2 MB)</label>
                    <input ref={inputRef} id="report-capture" type="file" accept="image/png,image/jpeg,image/webp" tabIndex={-1} className="sr-only" onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />
                    <div className="flex items-center justify-between gap-3 rounded-card border border-dashed border-line-2 bg-paper px-3 py-2 text-sm">
                      <span className="min-w-0 truncate font-semibold">Captura automática · {screenshot?.name}</span>
                      <button type="button" onClick={() => inputRef.current?.click()} className="shrink-0 text-xs font-semibold text-cata-red">Cambiar</button>
                    </div>
                  </div>
                ) : (
                  <FileDropZone
                    id="report-capture" label="Captura opcional (PNG, JPEG o WebP, hasta 2 MB)"
                    hint="Puedes adjuntar una imagen de tu equipo." accept="image/png,image/jpeg,image/webp"
                    file={screenshot} onFile={pickFile} chooseLabel="Elegir imagen"
                  />
                )}
                {fileError && <p role="alert" className="text-sm text-cata-red">{fileError}</p>}
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <p className="text-xs font-semibold text-ink-2">Vista previa</p>
                {screenshot && previewUrl ? (
                  <div className="flex flex-col gap-2">
                    <button type="button" onClick={() => setEnlarged(true)} aria-label="Ampliar captura" className="overflow-hidden rounded-card border border-cata-border">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview */}
                      <img src={previewUrl} alt="Vista previa de la captura" className="max-h-56 w-full object-contain" />
                    </button>
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-2 text-xs">
                        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" />
                        <span>La captura puede contener datos personales y solo la administración del club la verá. Acepto enviarla.</span>
                      </label>
                      <Button type="button" variant="secondary" onClick={() => pickFile(null)} className="shrink-0">Quitar captura</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-card border border-dashed border-line-2 p-3 text-sm text-ink-2">
                    <Camera size={ICON.base} aria-hidden="true" />
                    <span>{capture?.failed ? "No se pudo capturar la pantalla. Puedes adjuntar una imagen manualmente." : "Sin captura adjunta."}</span>
                  </div>
                )}
                <section aria-label="Así llegará tu reporte" className="card flex flex-col gap-2 p-3 text-sm">
                  <h3 className="font-semibold">Así llegará tu reporte</h3>
                  <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                    <dt className="text-xs font-bold uppercase text-ink-2">Descripción</dt><dd data-testid="report-preview-description" className="whitespace-pre-wrap break-words">{description.trim() || "—"}</dd>
                    <dt className="text-xs font-bold uppercase text-ink-2">Ruta</dt><dd className="break-all font-mono text-xs">{route || "—"}</dd>
                    <dt className="text-xs font-bold uppercase text-ink-2">Navegador</dt><dd className="break-words text-xs">{browser || "—"}</dd>
                    <dt className="text-xs font-bold uppercase text-ink-2">Captura</dt><dd>{attached ? "Con captura" : screenshot ? "Sin captura (falta tu autorización)" : "Sin captura"}</dd>
                  </dl>
                </section>
              </div>
            </div>
            {error && <p role="alert" className="px-5 pb-2 text-cata-red">{error}</p>}
            <footer className="flex justify-end gap-3 border-t border-cata-border px-5 py-3">
              <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button type="submit" variant="primary" disabled={blocked}>{sending ? "Enviando…" : "Enviar reporte"}</Button>
            </footer>
          </form>
        )}
      </section>
      {enlarged && previewUrl && (
        <div role="presentation" onClick={() => setEnlarged(false)} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview */}
          <img src={previewUrl} alt="Captura ampliada" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}
