/**
 * Choosing the players whose carnets to print as a batch (issue #1670).
 *
 * The list is the Miembros list narrowed to players (`canPrintCarnet`): staff
 * and representatives hold no carnet, and a represented minor with no account
 * of their own is on it. A whole category is printed from «Grupos y
 * horarios», which links here with the roster already chosen.
 *
 * Shape (T14B): one flat toolbar (search + bulk choose/clear), ONE card for the
 * list, and a selection bar that says how many are chosen and why printing is
 * not available yet. The bar is pinned to the bottom edge on a phone — above
 * the tab bar —
 * and a sticky side panel from `lg`. The list scrolls with the page: a second
 * scrollbar inside the page hid the bar's own rows on a phone.
 *
 * Issue #1749: the list is paged like Miembros (search first, then the page),
 * the selection lives outside the page so it survives paging and searching, and
 * each row carries the player's «Miembro desde» with an «Editar» that opens the
 * editor in place — outside the checkbox's label, so it never toggles the row.
 */

"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  EmptyState,
  ErrorState,
  FilterPanel,
  LoadingState,
  PAGE_RAIL,
  Pagination,
  SearchInput,
} from "@/components/ui";
import { toUserMessage } from "@/lib/error-message";
import { fetchMembers } from "@/services/api";
import {
  canPrintCarnet,
  carnetsHref,
  filterAccounts,
  getTotalPages,
  MEMBERS_PAGE_SIZE,
  paginateAccounts,
  type MemberAccount,
} from "../members-utils";
import MiembroDesdeEditor from "./MiembroDesdeEditor";
import { describeMiembroDesde, MAX_CARNETS, withAccountMiembroDesde } from "./carnet-sheet-utils";

export default function CarnetPicker(): React.ReactElement {
  const reasonId = useId();
  const router = useRouter();
  const [accounts, setAccounts] = useState<MemberAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMembers()
      .then((data) => {
        if (!cancelled) setAccounts(data.accounts.filter(canPrintCarnet));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(toUserMessage(cause, "No se pudieron cargar los jugadores."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => (accounts ? filterAccounts(accounts, search) : []), [accounts, search]);

  if (error) return <ErrorState title="No se pudieron cargar los jugadores" message={error} />;
  if (!accounts) return <LoadingState label="Cargando jugadores…" />;

  const total = accounts.length;
  const count = selected.length;
  const atLimit = count >= MAX_CARNETS;
  const totalPages = getTotalPages(visible.length);
  const pageRows = paginateAccounts(visible, page);
  const unchosenOnPage = pageRows.filter((account) => !selected.includes(account.id));

  function goToPage(next: number): void {
    setPage(next);
    setEditingId(null);
  }

  // A new search is a new list: back to its first page, nothing half-edited.
  function changeSearch(next: string): void {
    setSearch(next);
    goToPage(1);
  }

  function saveMiembroDesde(id: string, miembroDesde: string | null): void {
    setAccounts((current) => (current ? withAccountMiembroDesde(current, id, miembroDesde) : current));
  }

  function toggle(id: string): void {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  function chooseOnPage(): void {
    setSelected((current) => [...current, ...unchosenOnPage.map((account) => account.id)].slice(0, MAX_CARNETS));
  }

  if (total === 0) {
    return (
      <EmptyState
        title="Aún no hay jugadores"
        description="Cuando haya jugadores inscritos podrás imprimir sus carnets desde aquí."
      />
    );
  }

  return (
    <div
      data-testid="carnet-picker"
      className={`${PAGE_RAIL} max-lg:pb-24`}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <FilterPanel
          bare
          label="Buscar y elegir jugadores"
          className="sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:[&>div:first-child]:min-w-[17rem] sm:[&>div:first-child]:flex-1"
          search={
            <SearchInput
              label="Buscar jugadores"
              placeholder="Buscar por nombre o cédula…"
              value={search}
              onChange={changeSearch}
            />
          }
          fields={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={unchosenOnPage.length === 0 || atLimit}
                onClick={chooseOnPage}
              >
                {totalPages > 1 ? "Elegir esta página" : "Elegir visibles"} ({pageRows.length})
              </Button>
              <Button variant="tertiary" size="sm" disabled={count === 0} onClick={() => setSelected([])}>
                Quitar selección
              </Button>
            </div>
          }
        />
        {visible.length === 0 ? (
          <EmptyState
            title="Sin resultados"
            description="Ningún jugador coincide con la búsqueda."
            action={
              <Button variant="secondary" size="sm" onClick={() => changeSearch("")}>
                Limpiar búsqueda
              </Button>
            }
          />
        ) : (
          <div className="card overflow-hidden">
            <ul className="divide-y divide-line" aria-label="Jugadores">
              {pageRows.map((account) => {
                const name = `${account.nombres} ${account.apellidos}`;
                const checked = selected.includes(account.id);
                const blocked = !checked && atLimit;
                const editing = editingId === account.id;
                return (
                  <li key={account.id}>
                    <div className={`flex min-h-11 items-center gap-3 px-4 py-2.5 text-ink ${checked ? "bg-sunken" : ""}`}>
                      <label
                        className={`flex min-w-0 flex-1 items-center gap-3 self-stretch ${
                          blocked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={blocked}
                          onChange={() => toggle(account.id)}
                          aria-label={`Elegir a ${name}`}
                          className="h-5 w-5 flex-none accent-ink"
                        />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-semibold">{name}</span>
                          {account.representadoPor ? (
                            <span className="truncate text-xs text-ink-2">Representado por {account.representadoPor}</span>
                          ) : null}
                        </span>
                      </label>
                      <span className="max-w-28 flex-none text-right text-xs text-ink-2 sm:max-w-none">
                        {describeMiembroDesde(account.miembroDesde)}
                      </span>
                      <Button
                        variant="tertiary"
                        size="sm"
                        className="flex-none"
                        aria-expanded={editing}
                        aria-label={`${editing ? "Cerrar" : "Editar"} Miembro desde de ${name}`}
                        onClick={() => setEditingId(editing ? null : account.id)}
                      >
                        {editing ? "Cerrar" : "Editar"}
                      </Button>
                    </div>
                    {editing ? (
                      <div className="bg-sunken px-4 pb-3 pl-12">
                        <MiembroDesdeEditor
                          personaId={account.id}
                          name={name}
                          value={account.miembroDesde ?? null}
                          onSaved={(value) => saveMiembroDesde(account.id, value)}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {totalPages > 1 ? (
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={goToPage}
                totalItems={visible.length}
                pageSize={MEMBERS_PAGE_SIZE}
                itemNoun="jugador"
                variant="footer"
              />
            ) : null}
          </div>
        )}
      </div>

      <div
        data-testid="carnet-selection-bar"
        data-bottom-bar
        className={
          "flex items-center justify-between gap-3 bg-paper px-4 py-2.5 " +
          "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[62px] max-lg:z-20 max-lg:border-t-2 max-lg:border-edge " +
          "lg:sticky lg:top-4 lg:flex-col lg:items-stretch lg:gap-4 lg:rounded-[14px] lg:border-2 lg:border-edge lg:p-5 lg:shadow-sticker"
        }
      >
        <div className="flex min-w-0 flex-col gap-0.5 lg:gap-1">
          <p role="status" className="text-xs text-ink-2 lg:text-sm">
            <span className="font-display text-xl font-extrabold tabular-nums tracking-flat text-ink lg:text-3xl">{count}</span>{" "}
            de {total} seleccionados
          </p>
          {count === 0 ? (
            <p id={reasonId} className="text-xs text-ink-2">
              Elige al menos un jugador.
            </p>
          ) : null}
          <p className="text-xs text-ink-2">
            {atLimit ? `Llegaste al máximo de ${MAX_CARNETS}.` : `Máximo ${MAX_CARNETS} por impresión.`}
          </p>
        </div>
        <Button
          variant="primary"
          disabled={count === 0}
          aria-describedby={count === 0 ? reasonId : undefined}
          className="min-h-11 flex-none lg:w-full"
          onClick={() => router.push(carnetsHref(selected))}
        >
          {count === 0 ? "Generar carnets" : `Generar ${count} ${count === 1 ? "carnet" : "carnets"}`}
        </Button>
      </div>
    </div>
  );
}
