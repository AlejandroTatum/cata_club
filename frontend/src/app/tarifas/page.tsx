"use client";

/**
 * Tarifas — admin management of the club's membership price catalog (issue
 * #394/#400, plus "Nueva tarifa" from #507). The backend resolves a price
 * fresh at each `crearMembresia`/`registrar_pago` rather than freezing it on
 * the catalog row, so a price change only ever reaches FUTURE payments — the
 * reason the confirmation states that explicitly. Creating a tariff carries
 * no such caveat, so it skips the confirmation dialog entirely (see
 * `handleCreateSubmit`).
 *
 * A tariff is retired in two ways. "Ocultar" is always available and
 * reversible: the tariff leaves the site and enrollment, while whoever already
 * has it keeps paying the same. "Eliminar" is offered only while `enUso` is
 * false (no membresía ever used it) and cannot be undone.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import { NUMERIC_FIELD_LIMIT_MESSAGE } from "@/lib/numeric-input";
import { useNumericFieldMasking } from "@/lib/use-numeric-field-masking";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  InfoPanel,
  LoadingState,
  PAGE_RAIL,
  MoneyInput,
} from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/contexts/ToastContext";
import {
  fetchTiposMembresia,
  actualizarTipoMembresia,
  crearTipoMembresia,
  eliminarTipoMembresia,
} from "@/services/api";
import type { ActualizarTipoMembresiaInput, TipoMembresiaCatalogo } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import TarifaUsage from "./TarifaUsage";

const MODALIDAD_LABEL: Record<TipoMembresiaCatalogo["modalidad"], string> = {
  MENSUAL: "Mensual",
  PERSONALIZADA: "Personalizada",
};

/**
 * A positive decimal with at most 2 places — "45", "45.5", "45.00", never
 * "0", "-5", "45.123" or letters. A STRING check on purpose: `precio` never
 * becomes a JS `number` on this screen, so "positive" is excluded by
 * construction (a leading 1-9, or a `0.xx` with a non-zero digit) rather than
 * by a numeric comparison to 0. Always matched against a dot-normalized
 * value (see `normalizePrecio`) — it never sees a comma.
 */
const PRECIO_REGEX = /^(?:[1-9]\d*(?:\.\d{1,2})?|0\.(?:[1-9]\d?|0[1-9]))$/;

const PRECIO_ERROR =
  "Ingresa un precio válido: un número positivo con hasta 2 decimales (ej. 45.00).";

/**
 * Both "," and "." are accepted as the decimal separator (es-EC/es-AR admins
 * type a comma); normalized to "." before validation and before the payload
 * reaches `actualizarTipoMembresia`, which expects a `Decimal` string.
 *
 * Issue #667: the keystroke-level masking that used to be this file's own
 * `sanitizePrecioInput` (#506) now lives in `numeric-input.ts`'s `"amount"`
 * mode, shared with every other numeric field in the product — see
 * `precioMasking`/`newPrecioMasking` below. This function is unaffected: it
 * still runs at submit time, after the masked value already only ever
 * contains digits and at most one of either separator.
 */
function normalizePrecio(value: string): string {
  return value.trim().replace(",", ".");
}

/** Price field: full-width control with the "$" adornment inside the box. */

/** Mirrors the backend's own bound (`membresia_pago_schemas.py`'s
 *  `categoria: Optional[str] = Field(None, min_length=1, max_length=80)`) so
 *  an admin sees the rejection before the round trip, not after it. */
const CATEGORIA_MAX_LENGTH = 80;
const CATEGORIA_ERROR_VACIA = "Ingresa un nombre para la tarifa.";
const CATEGORIA_ERROR_LARGA = `El nombre no puede superar los ${CATEGORIA_MAX_LENGTH} caracteres.`;

const CATEGORIA_INPUT_CLASS =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-3 text-sm text-ink outline-none focus:border-cata-red";

/** The new-tariff form's field skin — same tokens `discounts/page.tsx` draws
 *  its own "Nuevo descuento" form with, spelled once. */
const FIELD_LABEL = "flex flex-col gap-field text-2xs font-bold uppercase text-ink-3";
const FIELD_CONTROL =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-3 text-sm text-ink outline-none focus:border-cata-red";

interface PendingConfirm {
  id: number;
  /** The name as it is BEFORE this save — needed for the dialog's "de X a Y"
   *  wording and to build the partial patch's success toast. */
  categoriaActual: string;
  /** `null` when the name did not change — omitted from the PATCH payload. */
  categoriaNueva: string | null;
  /** `null` when the price did not change — omitted from the PATCH payload. */
  precioNuevo: string | null;
}

/** The text-only "Eliminar" at the right edge of a card's actions: red text
 *  without a box until hovered, so it reads as the one irreversible action. */
const ELIMINAR_CLASS =
  "ml-auto inline-flex h-ctl-sm items-center justify-center gap-2 whitespace-nowrap rounded-ctl border border-transparent px-3 text-xs font-semibold text-state-bad transition-colors hover:bg-state-bad-bg disabled:cursor-not-allowed disabled:opacity-45";

const EMPTY_NEW_TARIFA = {
  categoria: "",
  precioInput: "",
  modalidad: "MENSUAL" as TipoMembresiaCatalogo["modalidad"],
};

/** A field caption with its required mark inline. The label is a flex column,
 *  so a bare sibling mark would drop to its own line (ADMB-28): both live in
 *  one caption element instead. */
function RequiredCaption({ children }: { children: string }): React.ReactElement {
  return (
    <span data-field-caption>
      {children} <span aria-hidden="true" className="text-state-bad">*</span>
    </span>
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

export default function TarifasPage(): React.ReactElement {
  const { showSuccess, showError } = useToast();

  const [tarifas, setTarifas] = useState<TipoMembresiaCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [precioInput, setPrecioInput] = useState("");
  const [categoriaInput, setCategoriaInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [categoriaError, setCategoriaError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingHide, setPendingHide] = useState<TipoMembresiaCatalogo | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TipoMembresiaCatalogo | null>(null);
  /** The tariff with a hide/show/delete request in flight. */
  const [busyId, setBusyId] = useState<number | null>(null);
  /** Why the last hide/show/delete failed (e.g. the 409 "ya se usó"), kept on
   *  screen above the cards until the next action. */
  const [actionError, setActionError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [revealTick, setRevealTick] = useState(0);
  const createFormRef = useRef<HTMLDivElement>(null);
  const [newTarifa, setNewTarifa] = useState(EMPTY_NEW_TARIFA);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  /**
   * Issue #667: keystroke/paste-level masking for the price row being
   * edited, and a separate instance for "Nueva tarifa"'s own price field —
   * two independent fields need two independent `limitReached` states.
   * `fullFilterOnChange` keeps this screen's pre-existing "strip everything
   * disallowed on every change" contract (#506's own test suite), rather
   * than the cap-only backstop `WizardInput`/`MedicalRecordEditor` use.
   */
  const precioMasking = useNumericFieldMasking(
    "amount",
    (value) => {
      setPrecioInput(value);
      setInputError(null);
    },
    { fullFilterOnChange: true },
  );
  const newPrecioMasking = useNumericFieldMasking(
    "amount",
    (value) => {
      setNewTarifa((prev) => ({ ...prev, precioInput: value }));
      setCreateError(null);
    },
    { fullFilterOnChange: true },
  );

  const loadCatalog = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setTarifas(await fetchTiposMembresia());
    } catch (err) {
      setLoadError(toUserMessage(err, "No se pudo cargar el catálogo de tarifas."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  function startEdit(tarifa: TipoMembresiaCatalogo): void {
    setEditingId(tarifa.id);
    setPrecioInput(tarifa.precio);
    setCategoriaInput(tarifa.categoria);
    setInputError(null);
    setCategoriaError(null);
    precioMasking.reset();
  }

  function cancelEdit(): void {
    setEditingId(null);
    setPrecioInput("");
    setCategoriaInput("");
    setInputError(null);
    setCategoriaError(null);
    precioMasking.reset();
  }

  /** "Guardar" click: validate locally, then open the confirmation — nothing
   *  mutates until the admin confirms it there. Only the fields that
   *  actually changed reach `pendingConfirm`/the PATCH payload: the BFF
   *  rejects an empty body, so an unchanged save closes edit mode instead of
   *  opening a confirmation for nothing. */
  function requestConfirm(tarifa: TipoMembresiaCatalogo): void {
    const categoriaTrimmed = categoriaInput.trim();
    if (!categoriaTrimmed) {
      setCategoriaError(CATEGORIA_ERROR_VACIA);
      return;
    }
    if (categoriaTrimmed.length > CATEGORIA_MAX_LENGTH) {
      setCategoriaError(CATEGORIA_ERROR_LARGA);
      return;
    }
    const precioValue = normalizePrecio(precioInput);
    if (!PRECIO_REGEX.test(precioValue)) {
      setInputError(PRECIO_ERROR);
      return;
    }
    setCategoriaError(null);
    setInputError(null);

    const categoriaChanged = categoriaTrimmed !== tarifa.categoria;
    const precioChanged = precioValue !== tarifa.precio;
    if (!categoriaChanged && !precioChanged) {
      cancelEdit();
      return;
    }

    setPendingConfirm({
      id: tarifa.id,
      categoriaActual: tarifa.categoria,
      categoriaNueva: categoriaChanged ? categoriaTrimmed : null,
      precioNuevo: precioChanged ? precioValue : null,
    });
  }

  async function confirmSave(): Promise<void> {
    const pending = pendingConfirm;
    if (!pending) return;
    setSaving(true);
    try {
      const payload: ActualizarTipoMembresiaInput = {};
      if (pending.categoriaNueva !== null) payload.categoria = pending.categoriaNueva;
      if (pending.precioNuevo !== null) payload.precio = pending.precioNuevo;
      const actualizada = await actualizarTipoMembresia(pending.id, payload);
      setTarifas((prev) => prev.map((t) => (t.id === actualizada.id ? actualizada : t)));
      showSuccess(buildSuccessMessage(pending, actualizada));
      setEditingId(null);
      setPrecioInput("");
      setCategoriaInput("");
      setPendingConfirm(null);
    } catch (err) {
      const message = toUserMessage(err, "No se pudo actualizar la tarifa.");
      setInputError(message);
      showError(message);
      setPendingConfirm(null);
    } finally {
      setSaving(false);
    }
  }

  /** Dialog "Cancelar": only closes the dialog. The row stays in edit mode so
   *  the admin can correct the value instead of starting over. */
  function cancelConfirm(): void {
    setPendingConfirm(null);
  }

  /** Reads from `actualizada.categoria`, not the local input, so a backend
   *  normalization (e.g. trimming) is what the toast actually reports. */
  function buildSuccessMessage(
    pending: PendingConfirm,
    actualizada: TipoMembresiaCatalogo,
  ): string {
    const categoriaChanged = pending.categoriaNueva !== null;
    const precioChanged = pending.precioNuevo !== null;
    if (categoriaChanged && precioChanged) {
      return `Tarifa «${pending.categoriaActual}» actualizada: nombre a «${actualizada.categoria}» y precio a $${actualizada.precio}.`;
    }
    if (categoriaChanged) {
      return `Nombre de «${pending.categoriaActual}» actualizado a «${actualizada.categoria}».`;
    }
    return `Precio de «${actualizada.categoria}» actualizado a $${actualizada.precio}.`;
  }

  /** The confirmation dialog's title/confirm label track exactly what is
   *  about to change — a price-only edit still reads "Cambiar precio", the
   *  wording the existing test suite (and admins) already know. */
  function confirmDialogLabel(pending: PendingConfirm | null): string {
    if (!pending) return "";
    if (pending.categoriaNueva !== null && pending.precioNuevo !== null) return "Cambiar tarifa";
    if (pending.categoriaNueva !== null) return "Cambiar nombre";
    return "Cambiar precio";
  }

  function buildConfirmMessage(pending: PendingConfirm): string {
    const parts: string[] = [];
    if (pending.categoriaNueva !== null) {
      parts.push(
        `Vas a cambiar el nombre de «${pending.categoriaActual}» a «${pending.categoriaNueva}».`,
      );
    }
    if (pending.precioNuevo !== null) {
      parts.push(
        `Vas a cambiar el precio a $${pending.precioNuevo}. El cambio aplica solo a los pagos futuros: las membresías y los pagos ya registrados no se modifican.`,
      );
    }
    return parts.join(" ");
  }

  // --- Ocultar / Mostrar / Eliminar -------------------------------------------

  async function setActivo(tarifa: TipoMembresiaCatalogo, activo: boolean): Promise<void> {
    setBusyId(tarifa.id);
    setActionError(null);
    try {
      const actualizada = await actualizarTipoMembresia(tarifa.id, { activo });
      setTarifas((prev) => prev.map((t) => (t.id === actualizada.id ? actualizada : t)));
      showSuccess(
        activo
          ? `Tarifa «${tarifa.categoria}» visible de nuevo.`
          : `Tarifa «${tarifa.categoria}» oculta. Los jugadores que ya la tienen siguen pagando igual.`,
      );
    } catch (err) {
      const message = toUserMessage(err, "No se pudo actualizar la tarifa.");
      setActionError(message);
      showError(message);
    } finally {
      setBusyId(null);
    }
  }

  /** "Ocultar" asks first, naming what changes; "Mostrar" only turns it back on. */
  function requestToggleActivo(tarifa: TipoMembresiaCatalogo): void {
    if (tarifa.activo) {
      setPendingHide(tarifa);
      return;
    }
    void setActivo(tarifa, true);
  }

  async function confirmHide(): Promise<void> {
    const tarifa = pendingHide;
    setPendingHide(null);
    if (!tarifa) return;
    await setActivo(tarifa, false);
  }

  /** A 409 (it was used after the page loaded) arrives with the server's own
   *  Spanish message, which `toUserMessage` lets through. */
  async function confirmDelete(): Promise<void> {
    const tarifa = pendingDelete;
    setPendingDelete(null);
    if (!tarifa) return;
    setBusyId(tarifa.id);
    setActionError(null);
    try {
      await eliminarTipoMembresia(tarifa.id);
      setTarifas((prev) => prev.filter((t) => t.id !== tarifa.id));
      showSuccess(`Tarifa «${tarifa.categoria}» eliminada.`);
    } catch (err) {
      const message = toUserMessage(err, "No se pudo eliminar la tarifa.");
      setActionError(message);
      showError(message);
    } finally {
      setBusyId(null);
    }
  }

  // --- Nueva tarifa (issue #507) --------------------------------------------
  // Same "open a rail form, validate on submit, reload on success" shape as
  // `discounts/page.tsx`'s create flow — no confirmation dialog here (unlike
  // the price edit above): creating a new catalog row has no existing pagos
  // or future charges to warn about, the way changing one does.

  useEffect(() => {
    if (revealTick > 0) revealForm(createFormRef.current);
  }, [revealTick]);

  function openCreateForm(): void {
    setRevealTick((tick) => tick + 1);
    setNewTarifa(EMPTY_NEW_TARIFA);
    setCreateError(null);
    setCreateOpen(true);
    newPrecioMasking.reset();
  }

  function closeCreateForm(): void {
    setCreateOpen(false);
    setCreateError(null);
    newPrecioMasking.reset();
  }

  async function handleCreateSubmit(): Promise<void> {
    const categoria = newTarifa.categoria.trim();
    if (!categoria) {
      setCreateError("Escribe el nombre de la tarifa.");
      return;
    }
    const precio = normalizePrecio(newTarifa.precioInput);
    if (!PRECIO_REGEX.test(precio)) {
      setCreateError(PRECIO_ERROR);
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      await crearTipoMembresia({ categoria, precio, modalidad: newTarifa.modalidad });
      showSuccess(`Tarifa «${categoria}» creada.`);
      closeCreateForm();
      await loadCatalog();
    } catch (err) {
      setCreateError(toUserMessage(err, "No se pudo crear la tarifa."));
    } finally {
      setCreating(false);
    }
  }

  /** The bare name input for edit mode — swapped in for the plain
   *  `tarifa.categoria` text both surfaces (`DataRow`'s `name` prop,
   *  `TableNameCell`'s `name` prop) otherwise render. Read mode never calls
   *  this: it keeps the name markup the `tarifas-name-column` e2e lock
   *  measures untouched. It has to stay a single inline element — both
   *  callers wrap `name` in a `<p>`/`<span>`, which cannot hold a block-level
   *  wrapper, so its own error message surfaces from `renderMeta` instead. */
  function renderNombreInput(tarifa: TipoMembresiaCatalogo): React.ReactElement {
    return (
      <label className={FIELD_LABEL}>
        Nombre
        <input
          type="text"
          value={categoriaInput}
          onChange={(e) => {
            setCategoriaInput(e.target.value);
            setCategoriaError(null);
          }}
          className={CATEGORIA_INPUT_CLASS}
          aria-label={`Nombre de ${tarifa.categoria}`}
          disabled={saving}
        />
        {categoriaError && (
          <span className="text-xs font-normal normal-case text-state-bad" role="alert">
            {categoriaError}
          </span>
        )}
      </label>
    );
  }

  /** Edit-mode price field plus its inline errors, aligned with the name
   *  field above it. Read mode shows the price as the card's headline. */
  function renderPrecioEditor(tarifa: TipoMembresiaCatalogo): React.ReactElement {
    return (
      <label className={FIELD_LABEL}>
        Precio mensual
        <MoneyInput
          value={precioInput}
          onChange={(e) => precioMasking.onChange(e.target.value)}
          onKeyDown={precioMasking.onKeyDown}
          onPaste={precioMasking.onPaste}
          aria-label={`Precio de ${tarifa.categoria}`}
          disabled={saving}
        />
        {inputError ? (
          <span className="text-xs font-normal normal-case text-state-bad" role="alert">
            {inputError}
          </span>
        ) : (
          precioMasking.limitReached && (
            <span aria-live="polite" className="text-xs font-semibold normal-case text-state-warn">
              {NUMERIC_FIELD_LIMIT_MESSAGE.amount}
            </span>
          )
        )}
      </label>
    );
  }

  function renderAcciones(tarifa: TipoMembresiaCatalogo): React.ReactElement {
    const isEditing = editingId === tarifa.id;
    const isSaving = saving && pendingConfirm?.id === tarifa.id;
    if (!isEditing) {
      const isBusy = busyId === tarifa.id;
      return (
        <>
          <Button size="sm" onClick={() => startEdit(tarifa)}>
            <Pencil size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Editar
          </Button>
          <Button
            size="sm"
            onClick={() => requestToggleActivo(tarifa)}
            disabled={isBusy}
            aria-label={`${tarifa.activo ? "Ocultar" : "Mostrar"} la tarifa ${tarifa.categoria}`}
          >
            {isBusy ? (
              <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
            ) : tarifa.activo ? (
              <EyeOff size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Eye size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            )}
            {tarifa.activo ? "Ocultar" : "Mostrar"}
          </Button>
          {!tarifa.enUso && (
            <button
              type="button"
              className={ELIMINAR_CLASS}
              onClick={() => setPendingDelete(tarifa)}
              disabled={isBusy}
              aria-label={`Eliminar la tarifa ${tarifa.categoria}`}
            >
              <Trash2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
              Eliminar
            </button>
          )}
        </>
      );
    }
    return (
      <>
        <Button size="sm" variant="dark" onClick={() => requestConfirm(tarifa)} disabled={saving}>
          {isSaving ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : null}
          Guardar
        </Button>
        <Button size="sm" onClick={cancelEdit} disabled={saving}>
          Cancelar
        </Button>
      </>
    );
  }

  /** Compact catalog summary: count and price range, from what is loaded. */
  function renderSummary(): React.ReactElement | null {
    if (tarifas.length === 0) return null;
    const visibles = tarifas.filter((t) => t.activo);
    const ocultas = tarifas.length - visibles.length;
    const prices = visibles.map((t) => Number.parseFloat(t.precio)).filter(Number.isFinite);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range =
      prices.length === 0
        ? "—"
        : min === max
          ? `$ ${min.toFixed(2)}`
          : `$ ${min.toFixed(2)} – $ ${max.toFixed(2)}`;
    return (
      <InfoPanel title="Resumen del catálogo">
        <dl className="grid grid-cols-2 gap-section">
          <div>
            <dt className="text-2xs font-bold uppercase text-ink-3">Tarifas</dt>
            <dd className="text-2xl font-extrabold tabular-nums text-ink">{visibles.length}</dd>
          </div>
          <div>
            <dt className="text-2xs font-bold uppercase text-ink-3">Rango de precios</dt>
            <dd className="text-sm font-bold tabular-nums text-ink">{range}</dd>
          </div>
        </dl>
        {ocultas > 0 && (
          <p>{ocultas === 1 ? "1 oculta" : `${ocultas} ocultas`}: no aparece en el sitio ni en inscripciones.</p>
        )}
      </InfoPanel>
    );
  }

  /** The rail's indications card: always visible, never collapsible. */
  function renderGuidance(): React.ReactElement {
    return (
      <InfoPanel title="Cómo se aplican las tarifas">
        <p>Cada tarifa define el precio y la modalidad de una membresía.</p>
        <p>
          <strong className="text-ink">Al editar un precio</strong>, el cambio aplica solo a los
          pagos futuros; las membresías y los pagos ya registrados no se modifican.
        </p>
        <p>
          <strong className="text-ink">Ocultar</strong> la saca del sitio y de las inscripciones;
          quienes ya la tienen siguen pagando igual.{" "}
          <strong className="text-ink">Eliminar</strong> solo aparece mientras nadie la usó y no se
          puede deshacer.
        </p>
        <p>Para sumar una categoría o modalidad, usa «Nueva tarifa».</p>
      </InfoPanel>
    );
  }

  function renderCreateForm(): React.ReactElement {
    return (
      <div ref={createFormRef} className="card flex flex-col gap-section p-[18px]">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
          Nueva tarifa
        </h2>
        <div className="flex flex-col gap-section">
          <label className={FIELD_LABEL}>
            <RequiredCaption>Nombre de la tarifa</RequiredCaption>
            <input
              type="text"
              required
              value={newTarifa.categoria}
              onChange={(e) => {
                setNewTarifa({ ...newTarifa, categoria: e.target.value });
                setCreateError(null);
              }}
              className={FIELD_CONTROL}
              placeholder="Mensual Infantil"
              disabled={creating}
              autoFocus
            />
          </label>
          <label className={FIELD_LABEL}>
            <RequiredCaption>Precio</RequiredCaption>
            <MoneyInput
              required
              value={newTarifa.precioInput}
              onChange={(e) => newPrecioMasking.onChange(e.target.value)}
              onKeyDown={newPrecioMasking.onKeyDown}
              onPaste={newPrecioMasking.onPaste}
              placeholder="45.00"
              disabled={creating}
            />
            {newPrecioMasking.limitReached && (
              <span aria-live="polite" className="text-2xs font-semibold normal-case text-state-warn">
                {NUMERIC_FIELD_LIMIT_MESSAGE.amount}
              </span>
            )}
          </label>
          <label className={FIELD_LABEL}>
            <RequiredCaption>Modalidad</RequiredCaption>
            <select
              value={newTarifa.modalidad}
              required
              onChange={(e) =>
                setNewTarifa({
                  ...newTarifa,
                  modalidad: e.target.value as TipoMembresiaCatalogo["modalidad"],
                })
              }
              className={FIELD_CONTROL}
              disabled={creating}
            >
              <option value="MENSUAL">Mensual</option>
              <option value="PERSONALIZADA">Personalizada</option>
            </select>
          </label>
        </div>
        {createError && (
          <p className="text-xs text-state-bad" role="alert">
            {createError}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="dark" onClick={() => void handleCreateSubmit()} disabled={creating}>
            {creating ? (
              <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            )}
            Crear
          </Button>
          <Button onClick={closeCreateForm} disabled={creating}>
            Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        title="Tarifas"
        subtitle="El precio y la modalidad de cada membresía del club."
        actions={
          <Button variant="dark" onClick={openCreateForm}>
            <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Nueva tarifa
          </Button>
        }
      >
        {loadError && <ErrorState message={loadError} onRetry={() => void loadCatalog()} />}
        {actionError && (
          <p role="alert" className="alert-error">
            {actionError}
          </p>
        )}

        <div data-testid="tarifas-split" className={PAGE_RAIL}>
          <div className="grid min-w-0 content-start gap-page">
            {loading ? (
              <section className="card flex min-w-0 flex-col overflow-hidden">
                <LoadingState label="Cargando tarifas…" />
              </section>
            ) : !loadError && tarifas.length === 0 ? (
              <section className="card flex min-w-0 flex-col overflow-hidden">
                <EmptyState
                  surface="inset"
                  fill
                  icon={<Tag size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                  title="Sin tarifas en el catálogo"
                  description="Todavía no hay tipos de membresía configurados."
                  action={
                    <Button variant="dark" onClick={openCreateForm}>
                      <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                      Crear primera tarifa
                    </Button>
                  }
                />
              </section>
            ) : tarifas.length > 0 ? (
              <ul
                data-testid="tarifas-cards"
                aria-label="Catálogo de tarifas"
                className="grid gap-page sm:grid-cols-2 2xl:grid-cols-3"
              >
                {tarifas.map((tarifa) => {
                  const isEditing = editingId === tarifa.id;
                  const oculta = !tarifa.activo;
                  return (
                    <li
                      key={tarifa.id}
                      data-oculta={oculta ? "true" : undefined}
                      className={cn(
                        "card flex min-w-0 flex-col gap-section p-[18px]",
                        !isEditing && "lg:min-h-56",
                        oculta && "bg-sunken",
                      )}
                    >
                      {isEditing ? (
                        <>
                          <h3 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
                            Editar tarifa
                          </h3>
                          {renderNombreInput(tarifa)}
                          {renderPrecioEditor(tarifa)}
                          <p className="text-xs text-ink-3">
                            El nuevo precio aplica solo a los pagos futuros.
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <h3
                              className={cn(
                                "min-w-0 flex-1 basis-full sm:basis-56 break-words font-display text-lg uppercase leading-tight tracking-flat",
                                oculta ? "text-ink-3" : "text-ink",
                              )}
                            >
                              {tarifa.categoria}
                            </h3>
                            <div className="flex flex-wrap gap-1">
                              <Badge tone={oculta ? "neutral" : "ok"}>{oculta ? "Oculta" : "Visible"}</Badge>
                              <Badge>{MODALIDAD_LABEL[tarifa.modalidad]}</Badge>
                            </div>
                          </div>
                          <div className="grid gap-1">
                            <p
                              className={cn(
                                "text-4xl font-extrabold tabular-nums",
                                oculta ? "text-ink-3" : "text-ink",
                              )}
                            >{`$ ${tarifa.precio}`}</p>
                            <p className="text-xs text-ink-3">
                              {oculta
                                ? "No aparece en el sitio ni en inscripciones. Los jugadores que ya la tienen siguen pagando igual."
                                : tarifa.enUso
                                  ? "Se usa en inscripción, pagos y cambio de plan."
                                  : "Todavía no se usó."}
                            </p>
                          </div>
                        </>
                      )}
                      <div className={cn("flex gap-2", !isEditing && "mt-auto")}>{renderAcciones(tarifa)}</div>
                    </li>
                  );
                })}
                <li className="flex sm:col-span-2 2xl:col-span-1">
                  <button
                    type="button"
                    onClick={openCreateForm}
                    className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-2 text-sm font-bold text-ink-2 transition-colors hover:border-cata-red hover:text-cata-red"
                  >
                    <Plus size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />
                    Agregar tarifa
                  </button>
                </li>
              </ul>
            ) : null}
            {!loading && tarifas.length > 0 ? <TarifaUsage /> : null}
          </div>

          <div data-testid="tarifas-rail" className="grid content-start gap-page">
            {createOpen ? renderCreateForm() : null}
            {renderSummary()}
            {renderGuidance()}
          </div>
        </div>

        <ConfirmDialog
          open={pendingConfirm !== null}
          variant="danger"
          title={confirmDialogLabel(pendingConfirm)}
          message={pendingConfirm ? buildConfirmMessage(pendingConfirm) : ""}
          confirmLabel={confirmDialogLabel(pendingConfirm)}
          onConfirm={() => void confirmSave()}
          onCancel={cancelConfirm}
        />

        <ConfirmDialog
          open={pendingHide !== null}
          variant="danger"
          title={pendingHide ? `¿Ocultar «${pendingHide.categoria}»?` : ""}
          message="Deja de aparecer en el sitio y en inscripciones nuevas. Los jugadores que ya la tienen siguen pagando igual. Puedes volver a mostrarla cuando quieras."
          confirmLabel="Ocultar"
          onConfirm={() => void confirmHide()}
          onCancel={() => setPendingHide(null)}
        />

        <ConfirmDialog
          open={pendingDelete !== null}
          variant="danger"
          title={pendingDelete ? `¿Eliminar «${pendingDelete.categoria}»?` : ""}
          message="Esta tarifa nunca se usó, así que se borra definitivamente. Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      </AppShell>
    </ProtectedRoute>
  );
}
