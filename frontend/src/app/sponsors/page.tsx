"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { crearSponsor, eliminarSponsor, fetchSponsors, type Sponsor } from "@/services/api";

export default function SponsorsPage(): React.ReactElement {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [nombre, setNombre] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try { setSponsors(await fetchSponsors()); } catch { setError("No se pudieron cargar los patrocinadores."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!nombre.trim() || !archivo) { setError("Escriba el nombre y seleccione un logo."); return; }
    setSaving(true); setError(null);
    try { await crearSponsor(nombre.trim(), archivo); setNombre(""); setArchivo(null); await load(); }
    catch { setError("No se pudo subir el logo. Use una imagen JPG o PNG de hasta 5 MB."); }
    finally { setSaving(false); }
  }
  async function remove(sponsor: Sponsor): Promise<void> {
    if (!window.confirm(`¿Eliminar el logo de ${sponsor.nombre}?`)) return;
    try { await eliminarSponsor(sponsor.id); await load(); }
    catch { setError("No se pudo eliminar el patrocinador."); }
  }

  return <ProtectedRoute allowedRoles={["admin"]}><AppShell
    title="Patrocinadores"
    subtitle="Suba el logo y el nombre que se leerá como texto alternativo en la landing."
  >
    <>
      <form onSubmit={submit} className="card flex flex-wrap items-end gap-4 p-5">
        <label className="flex flex-col gap-field text-sm font-semibold">Nombre corto<input value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} className="h-ctl rounded-ctl border border-line-2 px-3" /></label>
        <label className="flex flex-col gap-field text-sm font-semibold">Logo (JPG o PNG)<input type="file" accept="image/jpeg,image/png" onChange={(e: ChangeEvent<HTMLInputElement>) => setArchivo(e.target.files?.[0] ?? null)} /></label>
        <button type="submit" disabled={saving} className="h-ctl rounded-ctl bg-cata-red px-4 font-semibold text-white disabled:opacity-50">{saving ? "Subiendo…" : "Subir logo"}</button>
      </form>
      {error && <p role="alert" className="text-state-bad">{error}</p>}
      <section aria-label="Logos cargados" className="card p-5">
        {sponsors.length === 0 ? <p className="text-ink-2">Aún no hay patrocinadores cargados.</p> : <ul className="divide-y divide-line">{sponsors.map((sponsor) => <li key={sponsor.id} className="flex items-center justify-between gap-4 py-3"><div className="flex items-center gap-4"><img src={sponsor.logoUrl} alt={sponsor.nombre} className="h-12 w-24 object-contain" /><span>{sponsor.nombre}</span></div><button type="button" onClick={() => void remove(sponsor)} className="text-state-bad underline">Eliminar</button></li>)}</ul>}
      </section>
    </>
  </AppShell></ProtectedRoute>;
}
