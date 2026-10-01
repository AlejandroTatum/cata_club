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

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Percent, Plus, Power } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FilterPanel,
  InfoPanel,
  LoadingState,
  PAGE_RAIL,
  SearchInput,
} from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { fetchDescuentos, crearDescuento, actualizarDescuento } from "@/services/api";
import type { DescuentoCatalogo } from "@/services/api";
import { cn } from "@/components/ui/cn";
import { descuentoValorDisplay, filterDescuentos } from "./discounts-utils";
import DiscountTypes from "./DiscountTypes";
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

/** Empty catalog: both columns reach the bottom of the screen (page header and padding above, ~24px margin below). */
const FILL_SCREEN = "lg:min-h-[calc(100dvh-10rem)] lg:grid-rows-[auto_auto_1fr]";

/** Ghost example cards under the empty state: show what a catalog card looks
 *  like without pretending any discount exists. Purely decorative. */
const GHOST_EXAMPLES = [
  { nombre: "Beca deportiva", valor: "50 %", tipo: "Porcentaje" },
  { nombre: "Convenio familiar", valor: "$ 10,00", tipo: "Monto fijo" },
  { nombre: "Pago anticipado", valor: "15 %", tipo: "Porcentaje" },
  { nombre: "Hermanos", valor: "$ 5,00", tipo: "Monto fijo" },
];

function GhostCards(): React.ReactElement {
  return (
    <ul
      aria-hidden="true"
      className="grid auto-rows-fr gap-page opacity-50 sm:grid-cols-2 2xl:grid-cols-3"
    >
      {GHOST_EXAMPLES.map((example, index) => (
        <li
          key={example.nombre}
          className={cn(
            "flex min-h-56 min-w-0 flex-col gap-section rounded-card border border-dashed border-line-2 p-[18px]",
            index === 3 && "2xl:hidden",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-display text-lg uppercase leading-tight tracking-flat text-ink-2">
              {example.nombre}
            </span>
            <Badge>{example.tipo}</Badge>
          </div>
          <p className="text-4xl font-extrabold tabular-nums text-ink-3">{example.valor}</p>
          <span className="mt-auto text-2xs font-bold uppercase text-ink-3">Ejemplo</span>
        </li>
      ))}
    </ul>
  );
}

/** Brings a just-opened form into view and focuses its first field. On mobile
 *  the rail sits below the list, so without this the open button looks dead. */
function revealForm(container: HTMLElement | null): void {
  if (!container) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  container.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
  container.querySelector<HTMLElement>("input, select, textarea")?.focus({ preventScroll: true });
}

export default function DiscountsPage(): React.ReactElement {
  const { showSuccess, showError } = useToast();

  const [descuentos, setDescuentos] = useState<DescuentoCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Issue A3: /members and /payments both expose a search; /discounts mixes
  // real discounts with QA noise and had no way to narrow the list at all.
  const [searchTerm, setSearchTerm] = useState("");

  const [form, setForm] = useState<FormState | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  const createFormRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (revealTick > 0) revealForm(createFormRef.current);
  }, [revealTick]);

  function openCreateForm(): void {
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setRevealTick((tick) => tick + 1);
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
   * The rail always exists, like on every admin screen: the form (while one is
   * open) or the catalog summary, then the indications card, which is always
   * visible — also on an empty catalog.
   */
  const splitting = form !== null;

  /** The catalog narrowed by the search box — issue A3. */
  const filteredDescuentos = filterDescuentos(descuentos, searchTerm);

  /** True catalog-empty state (not a search with no hits): the main column
   *  continues with the discount-types explainer and fills the screen. */
  const emptyCatalog = !loading && !loadError && descuentos.length === 0 && !searchTerm;

  /** A short catalog (1–3 discounts) leaves the main column mostly empty, so
   *  the types explainer continues it and the column fills the screen. */
  const shortCatalog = !loading && !loadError && descuentos.length > 0 && descuentos.length < 4;

  /** The two actions a discount card carries (the card's footer). */
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
  function renderSummary(): React.ReactElement | null {
    if (descuentos.length === 0) return null;
    const activos = descuentos.filter((d) => d.activo).length;
    const inactivos = descuentos.length - activos;
    return (
      <InfoPanel title="Resumen del catálogo">
        <dl className="grid grid-cols-2 gap-section">
          <div>
            <dt className="text-2xs font-bold uppercase text-ink-3">Activos</dt>
            <dd className="text-2xl font-extrabold tabular-nums text-ink">{activos}</dd>
          </div>
          <div>
            <dt className="text-2xs font-bold uppercase text-ink-3">Inactivos</dt>
            <dd className="text-2xl font-extrabold tabular-nums text-ink">{inactivos}</dd>
          </div>
        </dl>
      </InfoPanel>
    );
  }

  /** The indications card: what a discount is and how it behaves. */
  function renderGuidance(): React.ReactElement {
    return (
      <InfoPanel title="Cómo funcionan los descuentos">
        <p>
          Un descuento reduce el valor de un pago y se elige al registrarlo.
        </p>
        {!emptyCatalog && (
          <p>
            <strong className="text-ink">Porcentaje:</strong> resta una parte del monto.{" "}
            <strong className="text-ink">Monto fijo:</strong> resta una cantidad en dólares.
          </p>
        )}
        <p>
          <strong className="text-ink">Activo:</strong> disponible para pagos nuevos.{" "}
          <strong className="text-ink">Inactivo:</strong> deja de aplicarse a pagos nuevos,
          sigue en la lista para reactivarlo y los pagos ya registrados no cambian.
        </p>
      </InfoPanel>
    );
  }

  /** The three form fields, shared by the rail's "Nuevo descuento" form and
   *  the inline editor inside a catalog card. */
  function renderFormFields(current: FormState): React.ReactElement {
    return (
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
            value={current.nombre}
            onChange={(e) => setForm({ ...current, nombre: e.target.value })}
            className={FIELD_CONTROL}
            placeholder="Beca municipal"
            aria-describedby="nombre-descuento-contador"
          />
          <span
            id="nombre-descuento-contador"
            className={cn(
              "text-2xs normal-case tracking-normal",
              current.nombre.length > MAX_NOMBRE_LENGTH ? "font-bold text-state-bad" : "text-ink-3",
            )}
          >
            {current.nombre.length}/{MAX_NOMBRE_LENGTH}
            {current.nombre.length > MAX_NOMBRE_LENGTH
              ? ` — supera el máximo por ${current.nombre.length - MAX_NOMBRE_LENGTH}. Acórtelo para poder guardar.`
              : ""}
          </span>
        </label>
        <label className={FIELD_LABEL}>
          Tipo <span aria-hidden="true" className="text-state-bad">*</span>
          <select
            value={current.modalidad}
            required
            onChange={(e) => setForm({ ...current, modalidad: e.target.value as Modalidad })}
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
            max={current.modalidad === "PORCENTAJE" ? 100 : AMOUNT_MAX_VALUE}
            step="0.01"
            value={current.valor}
            onChange={(e) => setForm({ ...current, valor: e.target.value })}
            className={FIELD_CONTROL}
            placeholder={current.modalidad === "PORCENTAJE" ? "50" : "10.00"}
          />
        </label>
        {formError && (
          <p className="text-xs text-state-bad" role="alert">
            {formError}
          </p>
        )}
      </div>
    );
  }

  function renderFormActions(current: FormState): React.ReactElement {
    return (
      <div className="flex gap-2">
        <Button variant="dark" onClick={() => void handleSubmit()} disabled={saving}>
          {saving ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          )}
          {current.editingId !== null ? "Guardar" : "Crear"}
        </Button>
        <Button onClick={closeForm} disabled={saving}>
          Cancelar
        </Button>
      </div>
    );
  }

  /** The rail's create form. Editing happens inline in the card instead. */
  function renderForm(): React.ReactElement | null {
    if (!form || form.editingId !== null) return null;
    return (
      <div ref={createFormRef} className="card flex flex-col gap-section p-[18px]">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
          Nuevo descuento
        </h2>
        {renderFormFields(form)}
        {renderFormActions(form)}
      </div>
    );
  }

  function renderCard(descuento: DescuentoCatalogo): React.ReactElement {
    if (form !== null && form.editingId === descuento.id) {
      return (
        <li
          key={descuento.id}
          className="card flex min-w-0 flex-col gap-section p-[18px] sm:col-span-2 2xl:col-span-1"
        >
          <h3 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
            Editar descuento
          </h3>
          {renderFormFields(form)}
          {renderFormActions(form)}
        </li>
      );
    }
    return (
      <li
        key={descuento.id}
        data-inactivo={descuento.activo ? undefined : "true"}
        className={cn(
          "card flex min-w-0 flex-col gap-section p-[18px] lg:min-h-56",
          !descuento.activo && "opacity-60",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 basis-40 break-words font-display text-lg uppercase leading-tight tracking-flat text-ink">
            {descuento.nombre}
          </h3>
          <Badge tone={descuento.activo ? "ok" : "neutral"}>
            {descuento.activo ? "Activo" : "Inactivo"}
          </Badge>
        </div>
        <div className="grid gap-1">
          <p className="text-4xl font-extrabold tabular-nums text-ink">
            {descuentoValorDisplay(descuento)}
          </p>
          <Badge className="w-fit">{descuento.porcentaje !== null ? "Porcentaje" : "Monto fijo"}</Badge>
        </div>
        <div className="mt-auto flex gap-2">{renderRowActions(descuento)}</div>
      </li>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        title="Descuentos"
        subtitle="Las rebajas que se pueden aplicar al registrar un pago."
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
          className={PAGE_RAIL}
        >
          <div className={cn("grid min-w-0 content-start gap-page", (emptyCatalog || shortCatalog) && FILL_SCREEN)}>
            {/* Search — issue A3, framed like `/members` and `/payments`. */}
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

            {loading ? (
              <section className="card flex min-w-0 flex-col overflow-hidden">
                <LoadingState label="Cargando descuentos…" />
              </section>
            ) : !loadError && filteredDescuentos.length === 0 ? (
              <>
                <section className="card flex min-w-0 flex-col overflow-hidden">
                  <EmptyState
                    surface="inset"
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
                </section>
                {!searchTerm ? <GhostCards /> : null}
              </>
            ) : filteredDescuentos.length > 0 ? (
              <ul
                data-testid="discounts-cards"
                aria-label="Catálogo de descuentos"
                className="grid gap-page sm:grid-cols-2 2xl:grid-cols-3"
              >
                {filteredDescuentos.map((descuento) => renderCard(descuento))}
                <li className="flex sm:col-span-2 2xl:col-span-1">
                  <button
                    type="button"
                    onClick={openCreateForm}
                    className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-card lg:min-h-56 border border-dashed border-line-2 text-sm font-bold text-ink-2 transition-colors hover:border-cata-red hover:text-cata-red"
                  >
                    <Plus size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />
                    Agregar descuento
                  </button>
                </li>
              </ul>
            ) : null}
            {shortCatalog ? <DiscountTypes placement="main" /> : null}
          </div>

          <div data-testid="discounts-rail" className="grid content-start gap-page">
            {splitting ? renderForm() : null}
            {renderSummary()}
            {renderGuidance()}
            {emptyCatalog ? <DiscountTypes /> : null}
          </div>
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

