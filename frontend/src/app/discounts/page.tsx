"use client";

/**
 * Descuentos — admin management of the club's discount catalog (issue #12).
 *
 * The catalog is the club's (modelo firmado §4): only an ADMINISTRADOR sees
 * this screen, and applying a discount to a payment happens at registration
 * time in /members — never here. There is deliberately NO delete: the soft
 * `activo` toggle is the only removal, because applied discounts reference
 * the catalog by FK and their values are frozen at application time, so
 * editing or deactivating here never rewrites payment history.
 *
 * The list shows active AND inactive entries (the backend's admin listado
 * does too): the inactive rows are the road to reactivation.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Percent, Plus, Power } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ContextualHelp from "@/components/ContextualHelp";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PAGE_RAIL,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { fetchDescuentos, crearDescuento, actualizarDescuento } from "@/services/api";
import type { DescuentoCatalogo } from "@/services/api";
import { cn } from "@/components/ui/cn";
import { descuentoValorLabel } from "./discounts-utils";
import { toUserMessage } from "@/lib/error-message";

type Modalidad = "PORCENTAJE" | "MONTO";

interface FormState {
  /** null while creating; the discount id while editing. */
  editingId: number | null;
  nombre: string;
  modalidad: Modalidad;
  valor: string;
}

const EMPTY_FORM: FormState = {
  editingId: null,
  nombre: "",
  modalidad: "PORCENTAJE",
  valor: "",
};

/**
 * The form's field skin, in the system's own vocabulary.
 *
 * The three fields were `rounded-lg` (8px — a radius DESIGN.md does not have)
 * over `cata-border`/`cata-surface`/`cata-text`, which is the palette the
 * foundation retired, at `px-2.5 py-1.5`, which is neither of the two control
 * heights. So the one form on this screen was drawn in a language no other
 * control in the product still speaks. This is the same recipe
 * `AttendanceFilters` uses for its own select, spelled once.
 */
const FIELD_CONTROL =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-3 text-sm text-ink outline-none focus:border-cata-red";

/** The caption above a field — the system's micro-label, at the field step. */
const FIELD_LABEL = "flex flex-col gap-field text-2xs font-bold uppercase text-ink-3";

export default function DiscountsPage(): React.ReactElement {
  const { showSuccess, showError } = useToast();

  const [descuentos, setDescuentos] = useState<DescuentoCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const loadCatalog = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setDescuentos(await fetchDescuentos());
    } catch (err) {
      setLoadError(toUserMessage(err, "No se pudo cargar el catálogo de descuentos."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  function openCreateForm(): void {
    setForm({ ...EMPTY_FORM });
    setFormError(null);
  }

  function openEditForm(descuento: DescuentoCatalogo): void {
    setForm({
      editingId: descuento.id,
      nombre: descuento.nombre,
      modalidad: descuento.porcentaje !== null ? "PORCENTAJE" : "MONTO",
      valor: String(Number(descuento.porcentaje ?? descuento.monto ?? 0)),
    });
    setFormError(null);
  }

  function closeForm(): void {
    setForm(null);
    setFormError(null);
  }

  async function handleSubmit(): Promise<void> {
    if (!form) return;
    const nombre = form.nombre.trim();
    if (!nombre) {
      setFormError("El nombre es obligatorio.");
      return;
    }
    const valor = Number(form.valor);
    if (!valor || valor <= 0) {
      setFormError("El valor debe ser mayor a 0.");
      return;
    }
    if (form.modalidad === "PORCENTAJE" && valor > 100) {
      setFormError("El porcentaje no puede superar 100.");
      return;
    }

    // Both keys travel always, the unused one as explicit null: that is how
    // the backend's PATCH changes a discount's modality without ambiguity.
    const valores = {
      porcentaje: form.modalidad === "PORCENTAJE" ? valor : null,
      monto: form.modalidad === "MONTO" ? valor : null,
    };

    setSaving(true);
    setFormError(null);
    try {
      if (form.editingId === null) {
        await crearDescuento({ nombre, ...valores });
        showSuccess("Descuento creado correctamente.");
      } else {
        await actualizarDescuento(form.editingId, { nombre, ...valores });
        showSuccess("Descuento actualizado correctamente.");
      }
      closeForm();
      await loadCatalog();
    } catch (err) {
      setFormError(toUserMessage(err, "No se pudo guardar el descuento."));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActivo(descuento: DescuentoCatalogo): Promise<void> {
    setTogglingId(descuento.id);
    try {
      await actualizarDescuento(descuento.id, { activo: !descuento.activo });
      showSuccess(
        descuento.activo
          ? "Descuento desactivado. Los pagos históricos no cambian."
          : "Descuento reactivado.",
      );
      await loadCatalog();
    } catch (err) {
      showError(toUserMessage(err, "No se pudo actualizar el descuento."));
    } finally {
      setTogglingId(null);
    }
  }

  /**
   * Whether the screen is a two-column split at all.
   *
   * The rail's argument is "the row being edited must not move", and it holds
   * for every state that HAS rows: the grid stays unconditional there, form
   * open or not, exactly as before. An empty catalog is the state that argument
   * says nothing about — there is no row to keep still — and reserving the
   * 340px track anyway put a blank column next to a card whose entire message
   * is that there is nothing here.
   */
  const splitting = form !== null || descuentos.length > 0;

  function renderForm(): React.ReactElement | null {
    if (!form) return null;
    const isEditing = form.editingId !== null;
    return (
      <div className="card flex flex-col gap-section p-[18px]">
        {/* La regla de Graduate: a card title is the 20px display step. This
            was `text-sm font-semibold` — 13.5px Barlow — which is the DENSE
            body step, i.e. the size a table cell uses. Three screens of this
            panel spelled their card titles three different ways; they all
            speak the one step now. */}
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
          {isEditing ? "Editar descuento" : "Nuevo descuento"}
        </h2>
        {/*
         * Single column, always — this form only ever renders inside the
         * 340px `PAGE_RAIL` (see `discounts-rail` below), never full-width.
         * A `sm:grid-cols-3` here split that 340px three ways (~90px per
         * field, minus the card's padding and gaps), cutting off
         * "Beca municipal" and "Porcentaje (%)" mid-word. Stacked, each
         * field gets the rail's full width.
         */}
        <div className="flex flex-col gap-section">
          <label className={FIELD_LABEL}>
            Nombre
            <input
              type="text"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              maxLength={100}
              className={FIELD_CONTROL}
              placeholder="Beca municipal"
            />
          </label>
          <label className={FIELD_LABEL}>
            Tipo
            <select
              value={form.modalidad}
              onChange={(e) => setForm({ ...form, modalidad: e.target.value as Modalidad })}
              className={FIELD_CONTROL}
            >
              <option value="PORCENTAJE">Porcentaje (%)</option>
              <option value="MONTO">Monto fijo ($)</option>
            </select>
          </label>
          <label className={FIELD_LABEL}>
            Valor
            <input
              type="number"
              min="0"
              max={form.modalidad === "PORCENTAJE" ? 100 : undefined}
              step="0.01"
              value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })}
              className={FIELD_CONTROL}
              placeholder={form.modalidad === "PORCENTAJE" ? "50" : "10.00"}
            />
          </label>
        </div>
        {formError && (
          <p className="text-xs text-state-bad" role="alert">
            {formError}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="dark" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? (
              <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            )}
            {isEditing ? "Guardar" : "Crear"}
          </Button>
          <Button onClick={closeForm} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        title="Descuentos"
        /*
         * The catalog has no pager: it renders `descuentos.map(...)` whole, so
         * its height is "how many discounts the club has" and no layout choice
         * on this screen makes it taller. The short measure does not close the
         * canvas under it — see `CONTENT_MEASURE` — it stops the four rows
         * being stretched across 1356px first.
         */
        measure="short"
        actions={
          <Button variant="dark" onClick={openCreateForm}>
            <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Nuevo descuento
          </Button>
        }
      >
        {loadError && (
          <ErrorState message={loadError} onRetry={() => void loadCatalog()} />
        )}

        {/*
         * The form is a RAIL, not a slab above the table.
         *
         * It used to render between the page header and the catalog, so
         * pressing "Editar" on the fourth row pushed that row roughly 200px
         * down and out of view — the admin was editing a record they could no
         * longer see, and "Cancelar" moved everything back up again. Beside
         * the table, the row being edited does not move at all.
         *
         * The grid keeps its two columns UNCONDITIONALLY, for the reason #81
         * gave the dashboard: a split that appears with the form is a layout
         * that moves under the admin every time they open one. With no form
         * open the rail is empty — it used to carry a permanent "Cómo
         * funciona el catálogo" card, which is now the `ContextualHelp`
         * disclosure above (issue #199).
         *
         * What this is NOT is a cure for vertical emptiness. A rail moves
         * content sideways; it cannot make a six-row table taller. See the
         * note on `PAGE_RAIL`.
         */}
        <div
          data-testid="discounts-split"
          className={splitting ? PAGE_RAIL : "flex min-w-0 flex-1 flex-col"}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-page">
            {/*
             * The catalog block, and the home the "Ver ayuda" disclosure never
             * had.
             *
             * It shipped as a bare child of the shell — no wrapper, no
             * className, a 16px underlined control alone in a 20px-gapped band
             * between the error slot and the grid. That was already the known
             * loose end: it lost the `mt-3` it used to hold itself up with when
             * `ContextualHelp` stopped carrying vertical margin, and nothing
             * caught it afterwards.
             *
             * D11c says where it goes: help belongs to the block it explains.
             * Every one of its three rules is about the CATALOG — a discount is
             * deactivated rather than deleted, editing never rewrites history,
             * and applying one happens on another screen — so its block is the
             * catalog card, in the header strip beside that card's title. That
             * is the same slot `/members` gives its own caveat, which is the
             * last slot of the block that owns it.
             */}
            <section className={cn("card flex min-w-0 flex-col overflow-hidden", !splitting && "flex-1")}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-[18px] py-3">
                <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
                  Catálogo de descuentos
                </h2>
                <ContextualHelp title="Cómo funciona el catálogo">
                  <ul className="flex flex-col gap-field">
                    <li>
                      Un descuento no se elimina: se{" "}
                      <b className="font-semibold text-ink">desactiva</b>. Deja de ofrecerse al
                      registrar pagos y sigue en la lista para reactivarlo.
                    </li>
                    <li>
                      Los pagos que ya lo usaron conservan el valor que tenía cuando se aplicó, así
                      que editarlo nunca reescribe el historial.
                    </li>
                    <li>
                      El descuento se aplica al registrar el pago, en Membresías y Pagos — no desde
                      esta pantalla.
                    </li>
                  </ul>
                </ContextualHelp>
              </div>

              {loading ? (
                <LoadingState label="Cargando descuentos…" />
              ) : !loadError && descuentos.length === 0 ? (
                <EmptyState
                  surface="inset"
                  // The screen's whole problem, in one prop. An empty catalog
                  // left 555px of bare canvas under a 265px statement — 62%,
                  // the largest dead-air figure of the entire redesign. `fill`
                  // puts the surplus INSIDE the card, which is the move
                  // `/members` already measured on the same component (25% →
                  // 15% on a search that found nobody).
                  fill
                  icon={<Percent size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                  title="Sin descuentos en el catálogo"
                  description="Cree el primer descuento para poder aplicarlo al registrar pagos."
                  action={
                    // Worded distinctly from the header's "Nuevo descuento" —
                    // same "Nueva categoría" / "Crear primera categoría" split
                    // Groups already draws — so the two controls read as one
                    // clear action for this moment, not a duplicate (issue #199).
                    <Button variant="dark" onClick={openCreateForm}>
                      <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                      Crear primer descuento
                    </Button>
                  }
                />
            ) : descuentos.length > 0 ? (
              /*
               * `ui/Table`, not a `<ul>` of `<li>`.
               *
               * This list was already a table — four aligned facts per row, the
               * same four every time — written as a flex list with its own `px-5
               * py-4`. That padding is why a discount row was a different height
               * from a member row and from an attendance row: three lists, three
               * answers, none of them the `h-row` token.
               *
               * There was no header at all, so the value column ("100%", "$5") had
               * nothing naming it. It has one now.
               */
              <div className="overflow-x-auto">
                <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Descuento</TableHeaderCell>
                        <TableHeaderCell>Valor</TableHeaderCell>
                        <TableHeaderCell>Estado</TableHeaderCell>
                        <TableHeaderCell align="right">
                          <span className="sr-only">Acciones</span>
                        </TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {descuentos.map((descuento) => {
                        const isToggling = togglingId === descuento.id;
                        return (
                          <TableRow
                            key={descuento.id}
                            data-inactivo={descuento.activo ? undefined : "true"}
                            className={descuento.activo ? undefined : "opacity-60"}
                          >
                            <TableNameCell name={descuento.nombre} />
                            <TableCell>{descuentoValorLabel(descuento)}</TableCell>
                            <TableCell>
                              <Badge tone={descuento.activo ? "ok" : "neutral"}>
                                {descuento.activo ? "Activo" : "Inactivo"}
                              </Badge>
                            </TableCell>
                            <TableCell align="right">
                              <div className="flex justify-end gap-2">
                                <Button size="sm" onClick={() => openEditForm(descuento)}>
                                  <Pencil size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                                  Editar
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => void handleToggleActivo(descuento)}
                                  disabled={isToggling}
                                >
                                  {isToggling ? (
                                    <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Power size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                                  )}
                                  {descuento.activo ? "Desactivar" : "Reactivar"}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            </section>
          </div>

          {/*
           * With no form open, the rail holds nothing — the anti-jump grid
           * from the comment above still needs its second track (see
           * PAGE_RAIL), but there is no longer a permanent card claiming it.
           * The catalog rules live in the card header beside the table now.
           *
           * It is only DRAWN while the screen is splitting, and that is the
           * one case the anti-jump argument does not cover: with an empty
           * catalog there is no row to hold still, so the 340px track was
           * reserved emptiness standing beside a statement that there is
           * nothing here — 340 of the 470 horizontal pixels this screen was
           * wasting. The instant a form opens, or the instant the catalog has
           * a row, the split is back and unconditional.
           */}
          {splitting ? <div data-testid="discounts-rail">{renderForm()}</div> : null}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

