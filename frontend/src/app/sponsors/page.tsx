"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { Button, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { crearSponsor, eliminarSponsor, fetchSponsors, type Sponsor } from "@/services/api";

const CONTROL = "h-ctl rounded-ctl border border-line-2 bg-paper px-3 text-sm font-normal text-ink";

export default function SponsorsPage(): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [nombre, setNombre] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  // Bumped after an upload so the uncontrolled file input remounts empty.
  const [inputKey, setInputKey] = useState(0);
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
      setNombre(""); setArchivo(null); setInputKey((k) => k + 1);
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
      <form onSubmit={submit} className={"card flex max-w-2xl flex-col gap-4 p-5"}>
        <div className="flex flex-col gap-field text-sm font-semibold">
          <label htmlFor="sponsor-nombre">Nombre corto</label>
          <input id="sponsor-nombre" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} className={CONTROL} />
        </div>
        <div className="flex flex-col gap-field text-sm font-semibold">
          <label htmlFor="sponsor-logo">Logo (JPG o PNG)</label>
          <input key={inputKey} id="sponsor-logo" type="file" accept="image/jpeg,image/png" onChange={(e: ChangeEvent<HTMLInputElement>) => setArchivo(e.target.files?.[0] ?? null)} className="w-full text-sm font-normal" />
          {vistaPrevia && (
            // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not optimizable by next/image
            <img src={vistaPrevia} alt="Vista previa del logo seleccionado" className="h-16 w-32 rounded-ctl border border-line bg-sunken object-contain" />
          )}
        </div>
        {error && <p ref={errorRef} role="alert" tabIndex={-1} className="text-sm text-state-bad">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Subiendo…" : "Subir logo"}</Button>
        </div>
      </form>
      <section aria-label="Logos cargados" className="card p-5">
        {cargando ? <LoadingState label="Cargando patrocinadores…" />
          : errorCarga ? <ErrorState message="No se pudieron cargar los patrocinadores." onRetry={() => void load()} />
          : sponsors.length === 0 ? <EmptyState title="Aún no hay patrocinadores cargados" description="Suba el primer logo con el formulario de arriba: aparecerá en la landing." />
          : <ul className="divide-y divide-line">{sponsors.map((sponsor) => <li key={sponsor.id} className="flex items-center justify-between gap-4 py-3">
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset */}
              <img src={sponsor.logoUrl} alt={`Logo de ${sponsor.nombre}`} loading="lazy" width={96} height={48} className="h-12 w-24 object-contain" />
              <span>{sponsor.nombre}</span>
            </div>
            <Button size="sm" className="text-state-bad" aria-label={`Eliminar ${sponsor.nombre}`} onClick={() => setPorEliminar(sponsor)}>Eliminar</Button>
          </li>)}</ul>}
      </section>
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
