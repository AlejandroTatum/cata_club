"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CalendarOff, Pencil, Send, Trash2 } from "lucide-react";
import CampoFormularioAdmin from "@/components/admin/CampoFormularioAdmin";
import ConfirmDialog from "@/components/ConfirmDialog";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { Button, EmptyState, ErrorState, LoadingState, PAGE_RAIL } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import { ICON } from "@/lib/icon-size";
import { clubIsoDate } from "@/lib/club-date";
import { formatNoClassRange } from "@/lib/no-class-days";
import {
  actualizarDiaSinClase,
  crearDiaSinClase,
  eliminarDiaSinClase,
  reenviarAvisoDiaSinClase,
  fetchDiasSinClase,
  type DiaSinClase,
} from "@/services/api";

const MOTIVO_MAX = 200;

export default function DiasSinClasePage(): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [dias, setDias] = useState<DiaSinClase[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const [editando, setEditando] = useState<DiaSinClase | null>(null);
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avisoFallido, setAvisoFallido] = useState<DiaSinClase | null>(null);
  const [porEliminar, setPorEliminar] = useState<DiaSinClase | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async (): Promise<void> => {
    setCargando(true); setErrorCarga(false);
    try { setDias(await fetchDiasSinClase()); } catch { setErrorCarga(true); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Move focus to the message so keyboard and screen-reader users land on it.
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function limpiarFormulario(): void {
    setEditando(null); setFechaInicio(""); setFechaFin(""); setMotivo(""); setError(null);
  }

  function empezarEdicion(dia: DiaSinClase): void {
    setEditando(dia);
    setFechaInicio(dia.fechaInicio);
    setFechaFin(dia.fechaFin === dia.fechaInicio ? "" : dia.fechaFin);
    setMotivo(dia.motivo);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!fechaInicio || !motivo.trim()) { setError("Indica la fecha y el motivo."); return; }
    if (fechaFin && fechaFin < fechaInicio) { setError("La fecha final no puede ser anterior a la inicial."); return; }
    const datos = { fecha_inicio: fechaInicio, fecha_fin: fechaFin || null, motivo: motivo.trim() };
    setSaving(true); setError(null);
    try {
      if (editando) {
        await actualizarDiaSinClase(editando.id, datos);
        showSuccess("Día sin clase actualizado.");
      } else {
        const creado = await crearDiaSinClase(datos);
        if (creado.avisoEncolado) {
          setAvisoFallido(null);
          showSuccess("Día sin clase publicado. Los socios recibirán el aviso.");
        } else {
          setAvisoFallido(creado);
        }
      }
      limpiarFormulario();
      await load();
    } catch (cause: unknown) {
      setError(toUserMessage(cause, "No se pudo guardar el día sin clase. Intenta de nuevo."));
    } finally { setSaving(false); }
  }

  async function reenviarAviso(dia: DiaSinClase): Promise<void> {
    try {
      await reenviarAvisoDiaSinClase(dia.id);
      if (avisoFallido?.id === dia.id) setAvisoFallido(null);
      showSuccess("Aviso reenviado a los socios.");
    } catch { showError("No se pudo reenviar el aviso. Intenta de nuevo."); }
  }

  async function confirmarEliminar(): Promise<void> {
    const dia = porEliminar;
    if (!dia) return;
    setPorEliminar(null);
    try {
      await eliminarDiaSinClase(dia.id);
      if (editando?.id === dia.id) limpiarFormulario();
      if (avisoFallido?.id === dia.id) setAvisoFallido(null);
      showSuccess("Día sin clase eliminado.");
      await load();
    } catch { showError("No se pudo eliminar el día sin clase."); }
  }

  const hoy = clubIsoDate();

  return <ProtectedRoute allowedRoles={["admin"]}><AppShell
    title="Días sin clase"
    subtitle="Feriados, eventos del club o cancha cerrada: avisa a los socios y esos días dejan de contar como clase."
  >
    <>
      <div className={PAGE_RAIL}>
        <div className="flex min-w-0 flex-col gap-page lg:col-start-2 lg:row-start-1">
          <form onSubmit={submit} noValidate className="card flex min-w-0 flex-col gap-2 p-4">
            <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
              {editando ? "Editar día sin clase" : "Agregar día sin clase"}
            </h2>
            <CampoFormularioAdmin label="Desde" type="date" value={fechaInicio} onChange={setFechaInicio} required />
            <CampoFormularioAdmin
              label="Hasta (opcional, si son varios días)" type="date" value={fechaFin} onChange={setFechaFin}
              labelClassName="mt-2 block text-2xs text-ink-3"
            />
            <CampoFormularioAdmin
              label="Motivo" type="textarea" value={motivo} onChange={(v) => setMotivo(v.slice(0, MOTIVO_MAX))} required
              placeholder="Ej.: Feriado nacional"
              labelClassName="mt-2 block text-2xs text-ink-3"
            />
            <p className="text-xs text-ink-2">
              {editando
                ? "Editar no vuelve a enviar el aviso en la app. Si cambias la fecha, el correo sale el día anterior a la fecha nueva."
                : "Al publicar, los socios reciben el aviso en la app. El correo les llega el día anterior, a las 08:00."}
            </p>
            {error && <p ref={errorRef} role="alert" tabIndex={-1} className="text-sm text-state-bad">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Guardando…" : editando ? "Guardar cambios" : "Publicar día sin clase"}
              </Button>
              {editando && <Button type="button" onClick={limpiarFormulario}>Cancelar</Button>}
            </div>
          </form>
        </div>
        <div className="flex min-w-0 flex-col gap-page lg:col-start-1 lg:row-start-1">
          {avisoFallido && (
            <div role="alert" className="card flex flex-wrap items-center gap-3 border-state-bad p-4">
              <p className="min-w-0 flex-1 text-sm text-ink">
                El día se guardó, pero no se pudo enviar el aviso a los socios.
              </p>
              <Button type="button" onClick={() => void reenviarAviso(avisoFallido)}>Reintentar aviso</Button>
            </div>
          )}
          <section aria-label="Días sin clase publicados" className="flex min-w-0 flex-col">
            {cargando ? <LoadingState label="Cargando días sin clase…" />
              : errorCarga ? <ErrorState message="No se pudieron cargar los días sin clase." onRetry={() => void load()} />
              : dias.length === 0 ? <EmptyState icon={<CalendarOff size={ICON.lg} />} title="Aún no hay días sin clase" description="Los días que publiques aparecen aquí y en el panel de los socios." />
              : <ul className="card flex flex-col divide-y divide-line p-0">{dias.map((dia) => <li key={dia.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{formatNoClassRange(dia)}</p>
                  <p className="break-words text-sm text-ink-2">{dia.motivo}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {dia.fechaFin >= hoy && (
                    <Button size="sm" aria-label={`Reenviar aviso ${formatNoClassRange(dia)}`} title="Reenviar aviso" onClick={() => void reenviarAviso(dia)}>
                      <Send size={ICON.sm} aria-hidden="true" />
                    </Button>
                  )}
                  <Button size="sm" aria-label={`Editar ${formatNoClassRange(dia)}`} onClick={() => empezarEdicion(dia)}>
                    <Pencil size={ICON.sm} aria-hidden="true" />
                  </Button>
                  <Button size="sm" className="text-state-bad" aria-label={`Eliminar ${formatNoClassRange(dia)}`} onClick={() => setPorEliminar(dia)}>
                    <Trash2 size={ICON.sm} aria-hidden="true" />
                  </Button>
                </div>
              </li>)}</ul>}
          </section>
        </div>
      </div>
      <ConfirmDialog
        open={porEliminar !== null}
        variant="danger"
        title="Eliminar día sin clase"
        message={porEliminar ? `¿Eliminar el día sin clase ${formatNoClassRange(porEliminar)}? Ese día volverá a contar como clase.` : ""}
        confirmLabel="Eliminar"
        onConfirm={() => void confirmarEliminar()}
        onCancel={() => setPorEliminar(null)}
      />
    </>
  </AppShell></ProtectedRoute>;
}
