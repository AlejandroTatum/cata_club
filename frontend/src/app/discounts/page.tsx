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
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Badge,
  Button,
  DataBox,
  DataRow,
  EmptyState,
  ErrorState,
  FilterPanel,
  InfoPanel,
  LoadingState,
  PAGE_RAIL,
  ResponsiveListTable,
  SearchInput,
  TableCell,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { fetchDescuentos, crearDescuento, actualizarDescuento } from "@/services/api";
import type { DescuentoCatalogo } from "@/services/api";
import { cn } from "@/components/ui/cn";
import { descuentoValorLabel, filterDescuentos } from "./discounts-utils";
import { toUserMessage } from "@/lib/error-message";
import { AMOUNT_MAX_VALUE } from "@/lib/numeric-input";

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
  // Issue A3: /members and /payments both expose a search; /discounts mixes
  // real discounts with QA noise and had no way to narrow the list at all.
  const [searchTerm, setSearchTerm] = useState("");

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
    // Issue #667: MONTO had no business ceiling — `max={undefined}` on the
    // native spinner below left it unbounded, and PORCENTAJE's own check
    // just above never applied to it. `AMOUNT_MAX_VALUE` (numeric-input.ts)
    // is the same ceiling `/tarifas`'s precio field enforces.
    if (form.modalidad === "MONTO" && valor > AMOUNT_MAX_VALUE) {
      setFormError(`El monto no puede superar $${AMOUNT_MAX_VALUE}.`);
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
   * The rail always exists: it holds the form while one is open and a calm
   * summary of the catalog otherwise. The track used to be dropped when no form
   * was open (#199 left it empty), which put a short table on a wide page with
   * nothing beside it; the summary is what now keeps the column honest.
   */
  const splitting = form !== null;
  /** An empty catalog centres its own empty state; a rail beside it would only crowd it. */
  const showRail = splitting || descuentos.length > 0;

  /** The catalog narrowed by the search box — issue A3. */
  const filteredDescuentos = filterDescuentos(descuentos, searchTerm);

  /**
   * Whether the catalog CARD stretches to the page's height.
   *
   * This is the empty state's `fill` and nothing else: it needs a tall parent
   * to centre itself in, and that is the only reason the card ever grew past
   * its own content. Applying it to a populated card would move the dead air
   * INSIDE the card, which reads worse than short canvas — bare canvas says
   * "the page ends here", a card with a floor of empty space says something
   * failed to render. `/members` draws its own table card the same way.
   *
   * Reads `filteredDescuentos`, not `descuentos`: a search that finds nobody
   * needs the same tall parent as a genuinely empty catalog.
   */
  const fillsHeight = form === null && filteredDescuentos.length === 0;

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

  /** The rail's resting state: what the catalog holds, from what is loaded. */
  function renderSummary(): React.ReactElement {
    const activos = descuentos.filter((d) => d.activo).length;
    const inactivos = descuentos.length - activos;
    return (
      <InfoPanel title="Resumen del catálogo">
        {descuentos.length > 0 ? (
          <p>
            {activos === 1 ? "1 descuento activo" : `${activos} descuentos activos`}
            {inactivos > 0
              ? ` y ${inactivos === 1 ? "1 inactivo" : `${inactivos} inactivos`}`
              : ""}
            .
          </p>
        ) : null}
        <p>
          Un descuento puede ser un porcentaje o un monto fijo y se elige al registrar un pago.
        </p>
        <p>
          Un descuento desactivado deja de aplicarse a pagos nuevos; los pagos ya registrados
          no cambian.
        </p>
      </InfoPanel>
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
            Nombre <span aria-hidden="true" className="text-state-bad">*</span>
            {/* No `maxLength` here on purpose (issue #314, K6 hallazgo #34):
                the DOM attribute used to clip a paste to 100 chars with zero
                feedback, and the toast on submit still said "correctamente"
                over a mutilated value. The full paste is kept and shown —
                the counter below turns into an error, and `handleSubmit`
                refuses to save until it fits, instead of saving something
                other than what was typed. */}
            <input
              type="text"
              required
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
            Tipo <span aria-hidden="true" className="text-state-bad">*</span>
            <select
              value={form.modalidad}
              required
              onChange={(e) => setForm({ ...form, modalidad: e.target.value as Modalidad })}
              className={FIELD_CONTROL}
            >
              <option value="PORCENTAJE">Porcentaje (%)</option>
              <option value="MONTO">Monto fijo ($)</option>
            </select>
          </label>
          <label className={FIELD_LABEL}>
            Valor <span aria-hidden="true" className="text-state-bad">*</span>
            <input
              type="number"
              required
              min="0"
              max={form.modalidad === "PORCENTAJE" ? 100 : AMOUNT_MAX_VALUE}
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
          className={showRail ? PAGE_RAIL : "flex min-w-0 flex-1 flex-col"}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-page">
            {/*
             * Search — issue A3. `/members` and `/payments` both frame their
             * own search in a `FilterPanel`; the discount catalog gets the
             * same slot, with no chips of its own to fill (there are no
             * quick-filter flags here, only the free-text search).
             */}
            <FilterPanel
              label="Filtros de descuentos"
              search={
                <SearchInput
                  label="Buscar descuentos"
                  placeholder="Buscar por nombre…"
                  value={searchTerm}
                  onChange={setSearchTerm}
                />
              }
            />

            <section className={cn("card flex min-w-0 flex-col overflow-hidden", fillsHeight && "flex-1")}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-[18px] py-3">
                <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
                  Catálogo de descuentos
                </h2>
              </div>

              {loading ? (
                <LoadingState label="Cargando descuentos…" />
              ) : !loadError && filteredDescuentos.length === 0 ? (
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
                  title={searchTerm ? "No se encontraron descuentos" : "Sin descuentos en el catálogo"}
                  description={
                    searchTerm
                      ? "Ningún descuento coincide con la búsqueda."
                      : "Cree el primer descuento para poder aplicarlo al registrar pagos."
                  }
                  action={
                    searchTerm ? (
                      <Button onClick={() => setSearchTerm("")}>Limpiar búsqueda</Button>
                    ) : (
                      // Worded distinctly from the header's "Nuevo descuento" —
                      // same "Nueva categoría" / "Crear primera categoría" split
                      // Groups already draws — so the two controls read as one
                      // clear action for this moment, not a duplicate (issue #199).
                      <Button variant="dark" onClick={openCreateForm}>
                        <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                        Crear primer descuento
                      </Button>
                    )
                  }
                />
            ) : filteredDescuentos.length > 0 ? (
              // Below `sm` a four-column table does not fit the viewport at
              // all (issue #339): at 320/375px the old single `overflow-x-auto`
              // wrapper left 522px of content scrolling the BODY sideways,
              // with Acciones (Editar/Desactivar) off-screen and no affordance
              // that anything was cut off. `/members` solves the same problem
              // by reflowing to one `DataRow` card per account below `sm` —
              // same data, actions inside the card instead of scrolled away —
              // and this list follows that exact pattern too, through the
              // shared `ResponsiveListTable` shell (see its doc comment).
              //
              // `ui/Table`, not a `<ul>` of `<li>`, at `sm` and up. This list
              // was already a table — four aligned facts per row, the same
              // four every time — written as a flex list with its own
              // `px-5 py-4`. That padding is why a discount row was a
              // different height from a member row and from an attendance
              // row: three lists, three answers, none of them the `h-row`
              // token. There was no header at all, so the value column
              // ("100%", "$5") had nothing naming it. It has one now.
              <ResponsiveListTable
                items={filteredDescuentos}
                getKey={(descuento) => descuento.id}
                mobileListTestId="discounts-cards"
                desktopTableTestId="discounts-table"
                renderCard={(descuento) => (
                  <DataRow
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
                )}
                tableHead={
                  <TableRow>
                    <TableHeaderCell>Descuento</TableHeaderCell>
                    <TableHeaderCell>Valor</TableHeaderCell>
                    <TableHeaderCell>Estado</TableHeaderCell>
                    <TableHeaderCell align="right">
                      <span className="sr-only">Acciones</span>
                    </TableHeaderCell>
                  </TableRow>
                }
                renderRow={(descuento) => (
                  <TableRow
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
                )}
              />
            ) : null}
            </section>
          </div>

          {showRail ? (
            <div data-testid="discounts-rail">{splitting ? renderForm() : renderSummary()}</div>
          ) : null}
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

