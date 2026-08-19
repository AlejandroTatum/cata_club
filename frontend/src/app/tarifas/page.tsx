"use client";

/**
 * Tarifas — admin editing of the club's membership price catalog (issue #394,
 * frontend half of #400). Price-only on purpose: `TipoMembresia` has no
 * soft-delete column and the backend resolves its price fresh at each
 * `crearMembresia`/`registrar_pago` rather than freezing it on the catalog
 * row, so a change here only ever reaches FUTURE payments — the reason the
 * confirmation states that explicitly.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Tag } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  Button,
  DataBox,
  DataRow,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { fetchTiposMembresia, actualizarTipoMembresia } from "@/services/api";
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
 * by a numeric comparison to 0.
 */
const PRECIO_REGEX = /^(?:[1-9]\d*(?:\.\d{1,2})?|0\.(?:[1-9]\d?|0[1-9]))$/;

const PRECIO_ERROR =
  "Ingrese un precio válido: un número positivo con hasta 2 decimales (ej. 45.00).";

const PRECIO_INPUT_CLASS =
  "h-ctl w-28 rounded-ctl border border-line-2 bg-paper px-3 text-right text-sm text-ink tabular-nums outline-none focus:border-cata-red";

interface PendingConfirm {
  id: number;
  categoria: string;
  precioNuevo: string;
}

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
  }

  function cancelEdit(): void {
    setEditingId(null);
    setPrecioInput("");
    setInputError(null);
  }

  /** "Guardar" click: validate locally, then open the confirmation — nothing
   *  mutates until the admin confirms it there. */
  function requestConfirm(tarifa: TipoMembresiaCatalogo): void {
    const value = precioInput.trim();
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

  function renderMeta(tarifa: TipoMembresiaCatalogo): React.ReactElement {
    if (editingId === tarifa.id) {
      return (
        <div className="flex flex-col gap-field">
          <input
            type="text"
            inputMode="decimal"
            value={precioInput}
            onChange={(e) => {
              setPrecioInput(e.target.value);
              setInputError(null);
            }}
            className={PRECIO_INPUT_CLASS}
            aria-label={`Precio de ${tarifa.categoria}`}
            disabled={saving}
          />
          {inputError && (
            <p className="text-xs text-state-bad" role="alert">
              {inputError}
            </p>
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

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell title="Tarifas" measure="short">
        {loadError && <ErrorState message={loadError} onRetry={() => void loadCatalog()} />}

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
            />
          ) : tarifas.length > 0 ? (
            <>
              <ul data-testid="tarifas-cards" className="divide-y divide-line sm:hidden">
                {tarifas.map((tarifa) => (
                  <DataRow
                    key={tarifa.id}
                    name={tarifa.categoria}
                    // Bundled into `meta` rather than `DataRow`'s own
                    // per-row prop of the same name as AppShell's header
                    // slot: this screen has no header action (see
                    // `primary-action.test.ts`'s `NO_HEADER_ACTION`, which
                    // greps the raw file and cannot tell the two props with
                    // that shared name apart). `meta` renders the same
                    // trailing flex row, so nothing about the card changes.
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
