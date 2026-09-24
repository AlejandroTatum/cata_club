"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { crearEntradaGaleria, eliminarEntradaGaleria, fetchGaleria, type GaleriaEntry } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";

/**
 * Admin management of the landing gallery (issue #1372).
 *
 * The gallery starts empty and the landing renders only what is persisted
 * here. Each entry is one photo with a short title and a description that
 * doubles as the photograph's accessible description. Limits mirror the
 * backend's `EntradaGaleriaCreateDTO` (título ≤ 80, descripción ≤ 500
 * characters) and its upload rules (JPG/PNG up to 5 MB); the visible word
 * counters (8/45) keep entries readable and always fit inside those
 * character ceilings, so a within-limits entry never turns into a backend
 * validation round-trip.
 *
 * Error-copy rules (issue #1372 task 4): file size is blamed ONLY on an
 * actual over-5 MB file, validated client-side. Backend/provider outages
 * (5xx, timeout, network — e.g. a preview without Cloudinary credentials)
 * surface as an honest service error: never as a size/format problem and
 * never leaking provider details. Actionable backend 4xx messages pass
 * through unchanged. An upload only succeeds once Cloudinary credentials
 * are configured — this form does not pretend otherwise.
 */

const TITULO_MAX_PALABRAS = 8;
const DESCRIPCION_MAX_PALABRAS = 45;
const TAMANIO_MAX_FOTO_BYTES = 5 * 1024 * 1024;

function contarPalabras(texto: string): number {
  const recortado = texto.trim();
  return recortado ? recortado.split(/\s+/).length : 0;
}

/** Client-side gate mirroring the backend upload rules; returns a specific
 * message or null when the file is acceptable. */
function errorDeArchivo(archivo: File): string | null {
  if (archivo.type !== "image/jpeg" && archivo.type !== "image/png") return "La foto debe ser un archivo JPG o PNG.";
  if (archivo.size > TAMANIO_MAX_FOTO_BYTES) return "La foto supera el límite de 5 MB. Elija una imagen más liviana.";
  return null;
}

export default function GaleriaPage(): React.ReactElement {
  const [entradas, setEntradas] = useState<GaleriaEntry[]>([]);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try { setEntradas(await fetchGaleria()); } catch { setError("No se pudo cargar la galería."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function seleccionarArchivo(event: ChangeEvent<HTMLInputElement>): void {
    const archivo = event.target.files?.[0] ?? null;
    if (!archivo) { setArchivo(null); return; }
    const errorArchivo = errorDeArchivo(archivo);
    if (errorArchivo) { setArchivo(null); event.target.value = ""; setError(errorArchivo); return; }
    setError(null); setArchivo(archivo);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!titulo.trim() || !descripcion.trim() || !archivo) { setError("Escriba el título, la descripción y seleccione una foto."); return; }
    if (contarPalabras(titulo) > TITULO_MAX_PALABRAS) { setError(`El título no puede superar las ${TITULO_MAX_PALABRAS} palabras.`); return; }
    if (contarPalabras(descripcion) > DESCRIPCION_MAX_PALABRAS) { setError(`La descripción no puede superar las ${DESCRIPCION_MAX_PALABRAS} palabras.`); return; }
    const errorArchivo = errorDeArchivo(archivo);
    if (errorArchivo) { setError(errorArchivo); return; }
    setSaving(true); setError(null);
    try { await crearEntradaGaleria(titulo.trim(), descripcion.trim(), archivo); setTitulo(""); setDescripcion(""); setArchivo(null); await load(); }
    catch (error: unknown) {
      // The translator is the only door for error text (error-message-usage
      // guard): actionable backend validation detail (4xx that passes its
      // who-was-this-written-for gates) is shown as-is; everything else —
      // 5xx, timeouts, network — is a service problem and must neither read
      // as a size/format problem nor leak provider details (fail closed to
      // this operation's service message).
      setError(toUserMessage(error, "El servicio de publicación no está disponible en este momento. Intente nuevamente más tarde."));
    }
    finally { setSaving(false); }
  }
  async function remove(entrada: GaleriaEntry): Promise<void> {
    if (!window.confirm(`¿Eliminar la foto "${entrada.titulo}"?`)) return;
    try { await eliminarEntradaGaleria(entrada.id); await load(); }
    catch { setError("No se pudo eliminar la foto."); }
  }

  return <ProtectedRoute allowedRoles={["admin"]}><AppShell
    title="Galería"
    subtitle="Publique las fotos que se muestran en la galería de la landing, con su título y descripción."
  >
    <>
      <form onSubmit={submit} className="card flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-field text-sm font-semibold">
          <label htmlFor="galeria-titulo">Título</label>
          <input id="galeria-titulo" value={titulo} maxLength={80} onChange={(e) => setTitulo(e.target.value)} className="h-ctl rounded-ctl border border-line-2 px-3" />
          <span className={`text-xs font-normal ${contarPalabras(titulo) > TITULO_MAX_PALABRAS ? "text-state-bad" : "text-ink-2"}`}>
            Máximo {TITULO_MAX_PALABRAS} palabras · {contarPalabras(titulo)}/{TITULO_MAX_PALABRAS}
          </span>
        </div>
        <div className="flex flex-col gap-field text-sm font-semibold">
          <label htmlFor="galeria-descripcion">Descripción de la foto</label>
          <textarea id="galeria-descripcion" value={descripcion} maxLength={500} rows={3} onChange={(e) => setDescripcion(e.target.value)} className="rounded-ctl border border-line-2 px-3 py-2" />
          <span className={`text-xs font-normal ${contarPalabras(descripcion) > DESCRIPCION_MAX_PALABRAS ? "text-state-bad" : "text-ink-2"}`}>
            Máximo {DESCRIPCION_MAX_PALABRAS} palabras · {contarPalabras(descripcion)}/{DESCRIPCION_MAX_PALABRAS}
          </span>
        </div>
        <label className="flex flex-col gap-field text-sm font-semibold">Foto (JPG o PNG)
          <input type="file" accept="image/jpeg,image/png" onChange={seleccionarArchivo} />
        </label>
        <button type="submit" disabled={saving} className="h-ctl rounded-ctl bg-cata-red px-4 font-semibold text-white disabled:opacity-50">{saving ? "Publicando…" : "Publicar foto"}</button>
      </form>
      {error && <p role="alert" className="text-state-bad">{error}</p>}
      <section aria-label="Fotos publicadas" className="card p-5">
        {entradas.length === 0 ? <p className="text-ink-2">Aún no hay fotos en la galería.</p> : <ul className="divide-y divide-line">{entradas.map((entrada) => <li key={entrada.id} className="flex items-center justify-between gap-4 py-3"><div className="flex min-w-0 items-center gap-4"><img src={entrada.imagenUrl} alt={entrada.descripcion} className="h-16 w-24 flex-none rounded object-cover" /><div className="min-w-0"><p className="truncate font-semibold">{entrada.titulo}</p><p className="truncate text-sm text-ink-2">{entrada.descripcion}</p></div></div><button type="button" onClick={() => void remove(entrada)} className="flex-none text-state-bad underline">Eliminar</button></li>)}</ul>}
      </section>
    </>
  </AppShell></ProtectedRoute>;
}
