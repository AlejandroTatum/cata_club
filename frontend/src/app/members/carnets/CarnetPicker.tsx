/**
 * Choosing the players whose carnets to print as a batch (issue #1670).
 *
 * The list is the Miembros list narrowed to players (`canPrintCarnet`): staff
 * and representatives hold no carnet, and a represented minor with no account
 * of their own is on it. A whole category is printed from «Grupos y
 * horarios», which links here with the roster already chosen.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, ErrorState, FilterPanel, LoadingState, SearchInput } from "@/components/ui";
import { toUserMessage } from "@/lib/error-message";
import { fetchMembers } from "@/services/api";
import { canPrintCarnet, carnetsHref, filterAccounts, type MemberAccount } from "../members-utils";
import { MAX_CARNETS } from "./carnet-sheet-utils";

export default function CarnetPicker(): React.ReactElement {
  const router = useRouter();
  const [accounts, setAccounts] = useState<MemberAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

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

  const atLimit = selected.length >= MAX_CARNETS;

  function toggle(id: string): void {
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  return (
    <div className="card overflow-hidden" data-testid="carnet-picker">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
        <FilterPanel
          label="Filtros de jugadores"
          search={
            <SearchInput
              label="Buscar jugadores"
              placeholder="Buscar por nombre o cédula…"
              value={search}
              onChange={setSearch}
            />
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-xs text-ink-2">
            {selected.length === 0
              ? "Ningún jugador elegido."
              : `${selected.length} ${selected.length === 1 ? "jugador elegido" : "jugadores elegidos"}`}
            {atLimit ? ` (máximo ${MAX_CARNETS})` : ""}
          </p>
          <Button
            variant="primary"
            disabled={selected.length === 0}
            onClick={() => router.push(carnetsHref(selected))}
          >
            Ver e imprimir carnets
          </Button>
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState surface="inset" title="Sin jugadores" description="Ningún jugador coincide con la búsqueda." />
      ) : (
        <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto" aria-label="Jugadores">
          {visible.map((account) => {
            const name = `${account.nombres} ${account.apellidos}`;
            const checked = selected.includes(account.id);
            return (
              <li key={account.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && atLimit}
                    onChange={() => toggle(account.id)}
                    aria-label={`Elegir a ${name}`}
                    className="h-4 w-4"
                  />
                  <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
                  {account.representadoPor ? (
                    <span className="hidden text-2xs text-ink-3 sm:inline">Representado por {account.representadoPor}</span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
