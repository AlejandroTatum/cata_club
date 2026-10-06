/**
 * Carnets — the admin prints players' carnets (issue #1670).
 *
 * `?ids=` names the players: ONE shows the very `MemberCard` the player sees
 * (same panel, same «Imprimir carnet», same sheet); several show the A4 sheet
 * (nine 85,6×54mm cards with crop marks, `CarnetSheet`). No `ids` is the
 * picker for a batch of Miembros. Grupos y horarios links here with a whole
 * category's roster (`?titulo=` names it).
 *
 * Admin only: `ProtectedRoute` is the UX, and `GET /api/carnets` — where the
 * data comes from — refuses anyone else on the server.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import MemberCard from "@/app/student/MemberCard";
import { BackLink, Button, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { toUserMessage } from "@/lib/error-message";
import { fetchCarnets } from "@/services/api";
import type { CarnetsResponse } from "@/services/api";
import CarnetPicker from "./CarnetPicker";
import CarnetSheet from "./CarnetSheet";
import { describeSheets, parseCarnetIds } from "./carnet-sheet-utils";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: CarnetsResponse };

function noop(): void {}

function CarnetsContent(): React.ReactElement {
  const params = useSearchParams();
  const idsKey = parseCarnetIds(params.get("ids")).join(",");
  const titulo = params.get("titulo");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchCarnets(idsKey.split(",").map(Number))
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ status: "error", message: toUserMessage(cause, "No se pudieron cargar los carnets.") });
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  if (!idsKey) return <CarnetPicker />;
  if (state.status === "loading") return <LoadingState label="Preparando carnets…" />;
  if (state.status === "error") return <ErrorState title="No se pudieron cargar los carnets" message={state.message} />;

  const { carnets, missing } = state.data;
  if (carnets.length === 0) {
    return (
      <EmptyState
        title="No hay carnets para imprimir"
        description="No se pudo leer a ninguno de los jugadores elegidos."
      />
    );
  }

  const missingNotice =
    missing.length > 0 ? (
      <p role="alert" className="text-xs text-state-bad">
        {missing.length === 1 ? "Un jugador no se pudo cargar y no está en la hoja." : `${missing.length} jugadores no se pudieron cargar y no están en la hoja.`}
      </p>
    ) : null;

  if (carnets.length === 1) {
    const [carnet] = carnets;
    return (
      <div className="grid gap-4">
        {missingNotice}
        <div className="mx-auto w-full max-w-md">
          <MemberCard
            profile={carnet.profile}
            coverageEnd={carnet.coverageEnd}
            horariosState={{ status: "ready", asignaciones: carnet.asignaciones }}
            canManagePhoto={false}
            onPhotoUploaded={noop}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <p role="status" className="text-sm text-ink-2">
          {titulo ? `${titulo}: ` : ""}
          {describeSheets(carnets.length)} · tarjeta de 85,6 × 54 mm con marcas de corte
        </p>
        <Button variant="primary" onClick={() => window.print()}>
          Imprimir {carnets.length} carnets
        </Button>
      </div>
      {missingNotice}
      <CarnetSheet carnets={carnets} />
    </div>
  );
}

export default function CarnetsPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        back={<BackLink href="/members" />}
        title="Carnets"
        subtitle="Imprime el carnet de un jugador o de varios en hojas A4."
      >
        {/* `useSearchParams` needs a boundary so the static shell can render without it. */}
        <Suspense fallback={<LoadingState label="Cargando carnets…" />}>
          <CarnetsContent />
        </Suspense>
      </AppShell>
    </ProtectedRoute>
  );
}
