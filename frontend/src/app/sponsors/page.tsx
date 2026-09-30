"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { Trash2 } from "lucide-react";
import { Button, EmptyState, ErrorState, FileDropZone, LoadingState, PAGE_RAIL } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { crearSponsor, eliminarSponsor, fetchSponsors, type Sponsor } from "@/services/api";

/** The landing strip's tile is 300-416px by 168px (landing.css `.landing-sponsor`): about 5:2. */
const TILE = "flex w-full items-center justify-center overflow-hidden rounded-card border border-line bg-sunken";
const TILE_STYLE = { aspectRatio: "5 / 2" } as const;
const CONTROL = "h-ctl rounded-ctl border border-line-2 bg-paper px-3 text-sm font-normal text-ink";

export default function SponsorsPage(): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [nombre, setNombre] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [porEliminar, setPorEliminar] = useState<Sponsor | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async (): Promise<void> => {
    setCargando(true); setErrorCarga(false);
    try { setSponsors(await fetchSponsors()); } catch { setErrorCarga(true); }
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

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!nombre.trim() || !archivo) { setError("Escriba el nombre y seleccione un logo."); return; }
    const nombreLimpio = nombre.trim();
    setSaving(true); setError(null);
    try {
      await crearSponsor(nombreLimpio, archivo);
      setNombre(""); setArchivo(null);
      showSuccess(`Logo de ${nombreLimpio} subido.`);
      await load();
    }
    catch { setError("No se pudo subir el logo. Use una imagen JPG o PNG de hasta 5 MB."); }
    finally { setSaving(false); }
  }

  async function confirmarEliminar(): Promise<void> {
    const sponsor = porEliminar;
    if (!sponsor) return;
    setPorEliminar(null);
    try { await eliminarSponsor(sponsor.id); showSuccess(`Logo de ${sponsor.nombre} eliminado.`); await load(); }
    catch { showError("No se pudo eliminar el patrocinador."); }
  }

  return <ProtectedRoute allowedRoles={["admin"]}><AppShell
    title="Patrocinadores"
    subtitle="Suba el logo y el nombre que se leerá como texto alternativo en la landing."
  >
    <>
      <div className={PAGE_RAIL}>
        <form onSubmit={submit} className="card flex min-w-0 flex-col gap-4 p-4 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1">
          <div className="flex flex-col gap-field text-sm font-semibold">
            <label htmlFor="sponsor-nombre">Nombre corto</label>
            <input id="sponsor-nombre" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} className={CONTROL} />
          </div>
          <FileDropZone
            id="sponsor-logo"
            label="Logo (JPG o PNG)"
            hint="JPG o PNG · máx. 5 MB"
            accept="image/jpeg,image/png"
            chooseLabel="Elegir logo"
            file={archivo}
            onFile={setArchivo}
          />
          <div className="flex flex-col gap-field">
            <p className="text-xs font-semibold text-ink-2">Así se verá en la landing</p>
            <div data-testid="sponsor-preview" style={TILE_STYLE} className={TILE}>
              {vistaPrevia ? (
                // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not optimizable by next/image
                <img src={vistaPrevia} alt="Vista previa del logo seleccionado" className="size-full object-contain p-2" />
              ) : (
                <span className="px-4 text-center text-xs text-ink-2">El logo aparecerá aquí al elegirlo.</span>
              )}
            </div>
          </div>
          {error && <p ref={errorRef} role="alert" tabIndex={-1} className="text-sm text-state-bad">{error}</p>}
          <Button type="submit" variant="primary" disabled={saving} className="self-start">{saving ? "Subiendo…" : "Subir logo"}</Button>
        </form>
        <section aria-label="Logos cargados" className="min-w-0 lg:col-start-1 lg:row-start-1">
          {cargando ? <LoadingState label="Cargando patrocinadores…" />
            : errorCarga ? <ErrorState message="No se pudieron cargar los patrocinadores." onRetry={() => void load()} />
            : sponsors.length === 0 ? <EmptyState title="Aún no hay patrocinadores cargados" description="Cuando suba el primer logo, aparecerá aquí y en la landing." />
            : <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">{sponsors.map((sponsor) => <li key={sponsor.id} className="card flex flex-col gap-2 p-3">
              <div style={TILE_STYLE} className={TILE}>
                {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset */}
                <img src={sponsor.logoUrl} alt={`Logo de ${sponsor.nombre}`} loading="lazy" width={200} height={80} className="size-full object-contain p-2" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold" title={sponsor.nombre}>{sponsor.nombre}</span>
                <Button size="sm" className="shrink-0 text-state-bad" aria-label={`Eliminar ${sponsor.nombre}`} onClick={() => setPorEliminar(sponsor)}>
                  <Trash2 size={ICON.sm} aria-hidden="true" />
                </Button>
              </div>
            </li>)}</ul>}
        </section>
      </div>
      <ConfirmDialog
        open={porEliminar !== null}
        variant="danger"
        title="Eliminar logo"
        message={porEliminar ? `¿Eliminar el logo de ${porEliminar.nombre}? Dejará de mostrarse en la landing.` : ""}
        confirmLabel="Eliminar"
        onConfirm={() => void confirmarEliminar()}
        onCancel={() => setPorEliminar(null)}
      />
    </>
  </AppShell></ProtectedRoute>;
}
