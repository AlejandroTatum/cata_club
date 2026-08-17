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
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Badge,
  Button,
  DataBox,
  DataRow,
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
 * Backend cap on `nombre` (issue #314, K6 hallazgo #34).
 *
 * The input used to carry a bare `maxLength={100}` — the DOM truncates a
 * paste past that silently, with no color change, no counter, nothing. 521
 * pasted characters became 100 saved ones under a green "Descuento creado
 * correctamente." toast. The fix is not a bigger truncation warning: it is
 * refusing to save a name that does not fit, the same way any other
 * out-of-range value on this form already blocks submit above.
 */
const MAX_NOMBRE_LENGTH = 100;

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
  // Issue #314 (K6 hallazgo #14): "Desactivar" fired PATCH on the first click,
  // no dialog, no naming of which discount was going dark. Only deactivating
  // gets the gate — reactivating just turns something back on and stays a
  // reversible one-click action, same as before.
  const [pendingDeactivation, setPendingDeactivation] = useState<DescuentoCatalogo | null>(null);

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
    if (nombre.length > MAX_NOMBRE_LENGTH) {
      setFormError(
        `El nombre no puede superar los ${MAX_NOMBRE_LENGTH} caracteres (tiene ${nombre.length}). Acórtelo para continuar.`,
      );
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

  /** "Desactivar" click: ask before mutating, naming the discount. "Reactivar"
   *  skips this entirely and mutates immediately — see `pendingDeactivation`. */
  function requestToggleActivo(descuento: DescuentoCatalogo): void {
    if (descuento.activo) {
      setPendingDeactivation(descuento);
      return;
    }
    void handleToggleActivo(descuento);
  }

  async function confirmPendingDeactivation(): Promise<void> {
    const descuento = pendingDeactivation;
    setPendingDeactivation(null);
    if (!descuento) return;
    await handleToggleActivo(descuento);
  }

  /**
   * Whether the screen is a two-column split at all: only while a form is open.
   *
   * The track used to be reserved the instant the catalog had a row, on the
   * anti-jump argument #81 gave the dashboard — a split that appears with the
   * form is a layout that moves under the admin every time they open one. The
   * argument is sound; the price it was paying stopped being worth it once
   * #199 emptied the rail. That issue moved the permanent "Cómo funciona el
   * catálogo" card into the header's disclosure and put nothing back, so the
   * ORDINARY state of this screen — a short table with nobody editing — was a
   * card beside 340px of reserved nothing. A track held open for content that
   * no longer exists is not a layout, it is a leftover.
   *
   * What the jump actually costs here is smaller than the #81 wording
   * suggests, and that is the reason this is affordable: #81 was about a form
   * that STACKED, pushing the row being edited ~200px down and out of view.
   * This form is a sibling of the table, so opening it reflows the table
   * horizontally and leaves every row on its own line. The guarantee #81 was
   * really buying — "the row you clicked does not run away from you" — is
   * pinned by the "puts the form beside the table" test, not by this flag.
   */
  const splitting = form !== null;

  /**
   * Whether the catalog CARD stretches to the page's height.
   *
   * This is the empty state's `fill` and nothing else: it needs a tall parent
   * to centre itself in, and that is the only reason the card ever grew past
   * its own content. Applying it to a populated card would move the dead air
   * INSIDE the card, which reads worse than short canvas — bare canvas says
   * "the page ends here", a card with a floor of empty space says something
   * failed to render. `/members` draws its own table card the same way.
   */
  const fillsHeight = form === null && descuentos.length === 0;

  /**
   * The two actions a discount carries, shared verbatim between the table row
   * (`sm` and up) and the card (below `sm`) — issue #339. Kept as one function
   * instead of two near-identical JSX blocks, the same way `/members` shares
   * `EditAccountButton` between `AccountRow` and `AccountCard`.
   */
  function renderRowActions(descuento: DescuentoCatalogo): React.ReactElement {
    const isToggling = togglingId === descuento.id;
    return (
      <>
        <Button size="sm" onClick={() => openEditForm(descuento)}>
          <Pencil size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Editar
        </Button>
        <Button size="sm" onClick={() => requestToggleActivo(descuento)} disabled={isToggling}>
          {isToggling ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <Power size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          )}
          {descuento.activo ? "Desactivar" : "Reactivar"}
        </Button>
      </>
    );
  }

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
            {/* No `maxLength` here on purpose (issue #314, K6 hallazgo #34):
                the DOM attribute used to clip a paste to 100 chars with zero
                feedback, and the toast on submit still said "correctamente"
                over a mutilated value. The full paste is kept and shown —
                the counter below turns into an error, and `handleSubmit`
                refuses to save until it fits, instead of saving something
                other than what was typed. */}
            <input
              type="text"
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              className={FIELD_CONTROL}
              placeholder="Beca municipal"
              aria-describedby="nombre-descuento-contador"
            />
            <span
              id="nombre-descuento-contador"
              className={cn(
                "text-2xs normal-case tracking-normal",
                form.nombre.length > MAX_NOMBRE_LENGTH ? "font-bold text-state-bad" : "text-ink-3",
              )}
            >
              {form.nombre.length}/{MAX_NOMBRE_LENGTH}
              {form.nombre.length > MAX_NOMBRE_LENGTH
                ? ` — supera el máximo por ${form.nombre.length - MAX_NOMBRE_LENGTH}. Acórtelo para poder guardar.`
                : ""}
            </span>
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
         * The second column now exists only while that form does — see
         * `splitting`. It used to be reserved from the first row onward, which
         * meant the state this screen is in almost all the time showed a table
         * beside 340px of nothing.
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
            <section className={cn("card flex min-w-0 flex-col overflow-hidden", fillsHeight && "flex-1")}>
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
              <>
                {/*
                 * Below `sm` a four-column table does not fit the viewport at
                 * all (issue #339): at 320/375px the old single `overflow-x-auto`
                 * wrapper left 522px of content scrolling the BODY sideways,
                 * with Acciones (Editar/Desactivar) off-screen and no affordance
                 * that anything was cut off. `/members` solves the same problem
                 * by reflowing to one `DataRow` card per account below `sm` —
                 * same data, actions inside the card instead of scrolled away —
                 * and this list now follows that exact pattern instead of
                 * inventing a scrolling-table variant of its own.
                 */}
                <ul data-testid="discounts-cards" className="divide-y divide-line sm:hidden">
                  {descuentos.map((descuento) => (
                    <DataRow
                      key={descuento.id}
                      name={descuento.nombre}
                      meta={<DataBox>{descuentoValorLabel(descuento)}</DataBox>}
                      status={
                        <Badge tone={descuento.activo ? "ok" : "neutral"}>
                          {descuento.activo ? "Activo" : "Inactivo"}
                        </Badge>
                      }
                      actions={renderRowActions(descuento)}
                      className={descuento.activo ? undefined : "opacity-60"}
                    />
                  ))}
                </ul>

                {/*
                 * `ui/Table`, not a `<ul>` of `<li>`, at `sm` and up.
                 *
                 * This list was already a table — four aligned facts per row, the
                 * same four every time — written as a flex list with its own `px-5
                 * py-4`. That padding is why a discount row was a different height
                 * from a member row and from an attendance row: three lists, three
                 * answers, none of them the `h-row` token.
                 *
                 * There was no header at all, so the value column ("100%", "$5") had
                 * nothing naming it. It has one now.
                 */}
                <div data-testid="discounts-table" className="hidden overflow-x-auto sm:block">
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
                      {descuentos.map((descuento) => (
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
                            <div className="flex justify-end gap-2">{renderRowActions(descuento)}</div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : null}
            </section>
          </div>

          {/*
           * The rail is the form's column and only the form's column, so it
           * is not drawn when there is no form — see `splitting` for why the
           * always-on track was retired. The catalog rules that used to live
           * here are the `ContextualHelp` in the card header now (#199), which
           * is what left this track holding nothing in the first place.
           */}
          {splitting ? <div data-testid="discounts-rail">{renderForm()}</div> : null}
        </div>

        <ConfirmDialog
          open={pendingDeactivation !== null}
          variant="danger"
          title="Desactivar descuento"
          message={
            pendingDeactivation
              ? `Va a desactivar el descuento «${pendingDeactivation.nombre}». Deja de poder aplicarse a pagos nuevos a partir de ahora, pero sigue en la lista para poder reactivarlo; los pagos ya registrados con este descuento no cambian.`
              : ""
          }
          confirmLabel="Desactivar"
          onConfirm={() => void confirmPendingDeactivation()}
          onCancel={() => setPendingDeactivation(null)}
        />
      </AppShell>
    </ProtectedRoute>
  );
}

