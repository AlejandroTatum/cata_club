"use client";

/**
 * Tarifas — admin management of the club's membership price catalog (issue
 * #394/#400, plus "Nueva tarifa" from #507). Editing a price has no
 * soft-delete equivalent here: `TipoMembresia` has no soft-delete column and
 * the backend resolves its price fresh at each `crearMembresia`/
 * `registrar_pago` rather than freezing it on the catalog row, so a price
 * change only ever reaches FUTURE payments — the reason the confirmation
 * states that explicitly. Creating a tariff carries no such caveat, so it
 * skips the confirmation dialog entirely (see `handleCreateSubmit`).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Tag } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import { NUMERIC_FIELD_LIMIT_MESSAGE } from "@/lib/numeric-input";
import { useNumericFieldMasking } from "@/lib/use-numeric-field-masking";
import {
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
import { fetchTiposMembresia, actualizarTipoMembresia, crearTipoMembresia } from "@/services/api";
import type { TipoMembresiaCatalogo } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";

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
  "Ingrese un precio válido: un número positivo con hasta 2 decimales (ej. 45.00).";

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

const PRECIO_INPUT_CLASS =
  "h-ctl w-28 rounded-ctl border border-line-2 bg-paper px-3 text-right text-sm text-ink tabular-nums outline-none focus:border-cata-red";

/** The new-tariff form's field skin — same tokens `discounts/page.tsx` draws
 *  its own "Nuevo descuento" form with, spelled once. */
const FIELD_LABEL = "flex flex-col gap-field text-2xs font-bold uppercase text-ink-3";
const FIELD_CONTROL =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-3 text-sm text-ink outline-none focus:border-cata-red";

interface PendingConfirm {
  id: number;
  categoria: string;
  precioNuevo: string;
}

const EMPTY_NEW_TARIFA = {
  categoria: "",
  precioInput: "",
  modalidad: "MENSUAL" as TipoMembresiaCatalogo["modalidad"],
};

export default function TarifasPage(): React.ReactElement {
  const { showSuccess, showError } = useToast();

  const [tarifas, setTarifas] = useState<TipoMembresiaCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [precioInput, setPrecioInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
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
    setInputError(null);
    precioMasking.reset();
  }

  function cancelEdit(): void {
    setEditingId(null);
    setPrecioInput("");
    setInputError(null);
    precioMasking.reset();
  }

  /** "Guardar" click: validate locally, then open the confirmation — nothing
   *  mutates until the admin confirms it there. */
  function requestConfirm(tarifa: TipoMembresiaCatalogo): void {
    const value = normalizePrecio(precioInput);
    if (!PRECIO_REGEX.test(value)) {
      setInputError(PRECIO_ERROR);
      return;
    }
    setInputError(null);
    setPendingConfirm({ id: tarifa.id, categoria: tarifa.categoria, precioNuevo: value });
  }

  async function confirmSave(): Promise<void> {
    const pending = pendingConfirm;
    if (!pending) return;
    setSaving(true);
    try {
      const actualizada = await actualizarTipoMembresia(pending.id, {
        precio: pending.precioNuevo,
      });
      setTarifas((prev) => prev.map((t) => (t.id === actualizada.id ? actualizada : t)));
      showSuccess(`Precio de «${actualizada.categoria}» actualizado a $${actualizada.precio}.`);
      setEditingId(null);
      setPrecioInput("");
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

  // --- Nueva tarifa (issue #507) --------------------------------------------
  // Same "open a rail form, validate on submit, reload on success" shape as
  // `discounts/page.tsx`'s create flow — no confirmation dialog here (unlike
  // the price edit above): creating a new catalog row has no existing pagos
  // or future charges to warn about, the way changing one does.

  function openCreateForm(): void {
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
      setCreateError("La categoría es obligatoria.");
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

  function renderMeta(tarifa: TipoMembresiaCatalogo): React.ReactElement {
    if (editingId === tarifa.id) {
      return (
        <div className="flex flex-col gap-field">
          <input
            type="text"
            inputMode="decimal"
            value={precioInput}
            onChange={(e) => precioMasking.onChange(e.target.value)}
            onKeyDown={precioMasking.onKeyDown}
            onPaste={precioMasking.onPaste}
            className={PRECIO_INPUT_CLASS}
            aria-label={`Precio de ${tarifa.categoria}`}
            disabled={saving}
          />
          {inputError ? (
            <p className="text-xs text-state-bad" role="alert">
              {inputError}
            </p>
          ) : (
            precioMasking.limitReached && (
              <p aria-live="polite" className="text-xs font-semibold text-state-warn">
                {NUMERIC_FIELD_LIMIT_MESSAGE.amount}
              </p>
            )
          )}
        </div>
      );
    }
    return (
      <>
        <DataBox>{`$ ${tarifa.precio}`}</DataBox>
        <DataBox>{MODALIDAD_LABEL[tarifa.modalidad]}</DataBox>
      </>
    );
  }

  function renderAcciones(tarifa: TipoMembresiaCatalogo): React.ReactElement {
    const isEditing = editingId === tarifa.id;
    const isSaving = saving && pendingConfirm?.id === tarifa.id;
    if (!isEditing) {
      return (
        <Button size="sm" onClick={() => startEdit(tarifa)}>
          <Pencil size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Editar precio
        </Button>
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

  function renderCreateForm(): React.ReactElement {
    return (
      <div className="card flex flex-col gap-section p-[18px]">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
          Nueva tarifa
        </h2>
        <div className="flex flex-col gap-section">
          <label className={FIELD_LABEL}>
            Categoría <span aria-hidden="true" className="text-state-bad">*</span>
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
            Precio <span aria-hidden="true" className="text-state-bad">*</span>
            <input
              type="text"
              inputMode="decimal"
              required
              value={newTarifa.precioInput}
              onChange={(e) => newPrecioMasking.onChange(e.target.value)}
              onKeyDown={newPrecioMasking.onKeyDown}
              onPaste={newPrecioMasking.onPaste}
              className={FIELD_CONTROL}
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
            Modalidad <span aria-hidden="true" className="text-state-bad">*</span>
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
        measure="short"
        actions={
          <Button variant="dark" onClick={openCreateForm}>
            <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Nueva tarifa
          </Button>
        }
      >
        {loadError && <ErrorState message={loadError} onRetry={() => void loadCatalog()} />}

        <div
          data-testid="tarifas-split"
          className={createOpen ? PAGE_RAIL : "flex min-w-0 flex-1 flex-col"}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-page">
            <section className="card flex min-w-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-line px-[18px] py-3">
                <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
                  Catálogo de tarifas
                </h2>
              </div>

              {loading ? (
                <LoadingState label="Cargando tarifas…" />
              ) : !loadError && tarifas.length === 0 ? (
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
              ) : tarifas.length > 0 ? (
                <>
                  <ul data-testid="tarifas-cards" className="divide-y divide-line sm:hidden">
                    {tarifas.map((tarifa) => (
                      <DataRow
                        key={tarifa.id}
                        name={tarifa.categoria}
                        // Opt-in only (#660): long tarifa/descuento names were
                        // truncating to "M…" on mobile. `nameWrap` is scoped
                        // to this page — the other five DataRow callers keep
                        // truncating by default.
                        nameWrap
                        // Bundled into `meta` rather than `DataRow`'s own
                        // per-row `actions` prop: this row's actions are
                        // "Editar precio"/"Guardar"/"Cancelar", distinct from
                        // the header's own "Nueva tarifa" (#507). `meta`
                        // renders the same trailing flex row, so nothing
                        // about the card layout changes.
                        meta={
                          <>
                            {renderMeta(tarifa)}
                            {renderAcciones(tarifa)}
                          </>
                        }
                      />
                    ))}
                  </ul>

                  <div data-testid="tarifas-table" className="hidden overflow-x-auto sm:block">
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableHeaderCell>Categoría</TableHeaderCell>
                          <TableHeaderCell>Precio</TableHeaderCell>
                          <TableHeaderCell>Modalidad</TableHeaderCell>
                          <TableHeaderCell align="right">
                            <span className="sr-only">Acciones</span>
                          </TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {tarifas.map((tarifa) => (
                          <TableRow key={tarifa.id}>
                            <TableNameCell name={tarifa.categoria} />
                            <TableCell>
                              {editingId === tarifa.id ? (
                                renderMeta(tarifa)
                              ) : (
                                `$ ${tarifa.precio}`
                              )}
                            </TableCell>
                            <TableCell>
                              {editingId === tarifa.id ? "" : MODALIDAD_LABEL[tarifa.modalidad]}
                            </TableCell>
                            <TableCell align="right">
                              <div className="flex justify-end gap-2">{renderAcciones(tarifa)}</div>
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

          {createOpen ? <div data-testid="tarifas-rail">{renderCreateForm()}</div> : null}
        </div>

        <ConfirmDialog
          open={pendingConfirm !== null}
          variant="danger"
          title="Cambiar precio"
          message={
            pendingConfirm
              ? `Va a cambiar el precio de «${pendingConfirm.categoria}» a $${pendingConfirm.precioNuevo}. El cambio aplica solo a los pagos futuros: las membresías y los pagos ya registrados no se modifican.`
              : ""
          }
          confirmLabel="Cambiar precio"
          onConfirm={() => void confirmSave()}
          onCancel={cancelConfirm}
        />
      </AppShell>
    </ProtectedRoute>
  );
}
