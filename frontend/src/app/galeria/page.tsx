"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { ImageIcon } from "lucide-react";
import { Button, ErrorState, FileDropZone, LoadingState, PAGE_RAIL } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import EmptyGrid from "./EmptyGrid";
import GaleriaPreview from "./GaleriaPreview";
import PublishGuide from "./PublishGuide";
import { crearEntradaGaleria, eliminarEntradaGaleria, fetchGaleria, type GaleriaEntry } from "@/services/api";
import { imageFileError, uploadErrorMessage } from "./uploadError";

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

function contarPalabras(texto: string): number {
  const recortado = texto.trim();
  return recortado ? recortado.split(/\s+/).length : 0;
}

const errorDeArchivo = (archivo: File): string | null => imageFileError(archivo, "La foto");

export default function GaleriaPage(): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [entradas, setEntradas] = useState<GaleriaEntry[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [porEliminar, setPorEliminar] = useState<GaleriaEntry | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async (): Promise<void> => {
    setCargando(true); setErrorCarga(false);
    try { setEntradas(await fetchGaleria()); } catch { setErrorCarga(true); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // The preview URL follows the selected file and is revoked on change/unmount.
  useEffect(() => {
    if (!archivo) { setVistaPrevia(null); return; }
    const url = URL.createObjectURL(archivo);
    setVistaPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  // Move focus to the message so keyboard and screen-reader users land on it.
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function aceptarArchivo(candidato: File | null): void {
    if (!candidato) { setArchivo(null); return; }
    const errorArchivo = errorDeArchivo(candidato);
    if (errorArchivo) { setArchivo(null); setError(errorArchivo); return; }
    setError(null); setArchivo(candidato);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!titulo.trim() || !descripcion.trim() || !archivo) { setError("Escriba el título, la descripción y seleccione una foto."); return; }
    if (contarPalabras(titulo) > TITULO_MAX_PALABRAS) { setError(`El título no puede superar las ${TITULO_MAX_PALABRAS} palabras.`); return; }
    if (contarPalabras(descripcion) > DESCRIPCION_MAX_PALABRAS) { setError(`La descripción no puede superar las ${DESCRIPCION_MAX_PALABRAS} palabras.`); return; }
    const errorArchivo = errorDeArchivo(archivo);
    if (errorArchivo) { setError(errorArchivo); return; }
    setSaving(true); setError(null);
    try {
      await crearEntradaGaleria(titulo.trim(), descripcion.trim(), archivo);
      setTitulo(""); setDescripcion(""); setArchivo(null);
      showSuccess("Foto publicada en la galería.");
      await load();
    }
    catch (error: unknown) {
      setError(uploadErrorMessage(error, "No se pudo publicar la foto. Intente de nuevo."));
    }
    finally { setSaving(false); }
  }

  async function confirmarEliminar(): Promise<void> {
    const entrada = porEliminar;
    if (!entrada) return;
    setPorEliminar(null);
    try { await eliminarEntradaGaleria(entrada.id); showSuccess("Foto eliminada de la galería."); await load(); }
    catch { showError("No se pudo eliminar la foto."); }
  }

  const tituloPalabras = contarPalabras(titulo);
  const descripcionPalabras = contarPalabras(descripcion);
  const tituloExcedido = tituloPalabras > TITULO_MAX_PALABRAS;
  const descripcionExcedida = descripcionPalabras > DESCRIPCION_MAX_PALABRAS;
  const CONTROL = "rounded-ctl border border-line-2 bg-paper px-3 text-sm font-normal text-ink";

  return <ProtectedRoute allowedRoles={["admin"]}><AppShell
    title="Galería"
    subtitle="Publique las fotos que se muestran en la galería de la landing, con su título y descripción."
  >
    <>
      <div className={PAGE_RAIL}>
        <div className="flex min-w-0 flex-col gap-page max-lg:contents lg:col-start-2 lg:row-start-1">
        <PublishGuide className="max-lg:order-3" title="Cómo se publica en el sitio" rules={[
          { term: "Dónde aparece", detail: "Cada foto es una diapositiva de la galería de la landing, con su título y descripción." },
          { term: "Título y descripción", detail: `Hasta ${TITULO_MAX_PALABRAS} palabras el título y ${DESCRIPCION_MAX_PALABRAS} la descripción; esta última es también la descripción accesible de la foto.` },
          { term: "Orden y visibilidad", detail: "Se muestran de inmediato, de la más antigua a la más reciente. No hay borradores." },
          { term: "Al eliminar", detail: "La foto deja de mostrarse en la landing y no se puede recuperar." },
        ]} />
        <form onSubmit={submit} className="card flex max-lg:order-1 min-w-0 flex-col gap-4 p-4">
          <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Subir foto</h2>
          <FileDropZone
            id="galeria-foto"
            label="Foto (JPG o PNG)"
            hint="JPG o PNG · máx. 5 MB"
            accept="image/jpeg,image/png"
            required
            file={archivo}
            onFile={aceptarArchivo}
          />
          <div className="flex flex-col gap-field">
            <p className="text-xs font-semibold text-ink-2">Así se verá en la galería del sitio</p>
            <div data-testid="galeria-preview"><GaleriaPreview imageUrl={vistaPrevia} title={titulo.trim()} description={descripcion.trim()} /></div>
          </div>
          <div className="flex flex-col gap-field text-sm font-semibold">
            <label htmlFor="galeria-titulo">Título</label>
            <input id="galeria-titulo" value={titulo} maxLength={80} aria-required="true" aria-invalid={tituloExcedido} aria-describedby="galeria-titulo-cuenta" onChange={(e) => setTitulo(e.target.value)} className={`h-ctl ${CONTROL}`} />
            <span id="galeria-titulo-cuenta" className={`text-xs font-normal ${tituloExcedido ? "text-state-bad" : "text-ink-2"}`}>
              Máximo {TITULO_MAX_PALABRAS} palabras · {tituloPalabras}/{TITULO_MAX_PALABRAS}
            </span>
          </div>
          <div className="flex flex-col gap-field text-sm font-semibold">
            <label htmlFor="galeria-descripcion">Descripción de la foto</label>
            <textarea id="galeria-descripcion" value={descripcion} maxLength={500} rows={3} aria-required="true" aria-invalid={descripcionExcedida} aria-describedby="galeria-descripcion-cuenta" onChange={(e) => setDescripcion(e.target.value)} className={`py-2 ${CONTROL}`} />
            <span id="galeria-descripcion-cuenta" className={`text-xs font-normal ${descripcionExcedida ? "text-state-bad" : "text-ink-2"}`}>
              Máximo {DESCRIPCION_MAX_PALABRAS} palabras · {descripcionPalabras}/{DESCRIPCION_MAX_PALABRAS}
            </span>
          </div>
          {error && <p ref={errorRef} id="galeria-error" role="alert" tabIndex={-1} className="text-sm text-state-bad">{error}</p>}
          <Button type="submit" variant="primary" disabled={saving || !archivo} className="self-start">{saving ? "Publicando…" : "Publicar foto"}</Button>
        </form>
        </div>
        <section aria-label="Fotos publicadas" className="flex min-w-0 flex-col max-lg:order-2 lg:col-start-1 lg:row-start-1 lg:self-stretch">
          {cargando ? <LoadingState label="Cargando fotos…" />
            : errorCarga ? <ErrorState message="No se pudo cargar la galería." onRetry={() => void load()} />
            : entradas.length === 0 ? <EmptyGrid icon={<ImageIcon size={ICON.lg} />} title="Aún no hay fotos en la galería" description="Las fotos publicadas aparecen aquí y en la galería del sitio." tileRatio="3 / 2" tiles={15} />
            : <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
              {entradas.map((entrada) => <li key={entrada.id} className="card flex flex-col overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset */}
                <img src={entrada.imagenUrl} alt={entrada.titulo} loading="lazy" width={400} height={267} style={{ aspectRatio: "3 / 2" }} className="h-auto w-full bg-sunken object-cover" />
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="truncate text-sm font-semibold" title={entrada.titulo}>{entrada.titulo}</p>
                  <p className="line-clamp-2 text-xs text-ink-2">{entrada.descripcion}</p>
                  <Button size="sm" className="mt-2 self-start text-state-bad" aria-label={`Eliminar ${entrada.titulo}`} onClick={() => setPorEliminar(entrada)}>Eliminar</Button>
                </div>
              </li>)}
            </ul>}
        </section>
      </div>
      <ConfirmDialog
        open={porEliminar !== null}
        variant="danger"
        title="Eliminar foto"
        message={porEliminar ? `¿Eliminar la foto "${porEliminar.titulo}"? Dejará de mostrarse en la landing.` : ""}
        confirmLabel="Eliminar"
        onConfirm={() => void confirmarEliminar()}
        onCancel={() => setPorEliminar(null)}
      />
    </>
  </AppShell></ProtectedRoute>;
}
