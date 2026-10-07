"use client";

/**
 * `/members/[id]/pagos` — one member's payments on a page of their own (#1668).
 *
 * It replaces the Pagos dialog the Miembros list used to open: the owner's
 * clients got lost inside the modal at the first payment, at «socio nuevo o
 * antiguo» and when correcting a payment or a month. The forms are the same
 * ones the dialog rendered (`StudentMembershipActions`) — what is new here is
 * the page around them: where the member stands in plain words, ONE obvious
 * action, and a clear way back.
 *
 * Route choice: a dynamic segment (`[id]`) rather than a query parameter, so
 * the URL names the member, survives a reload and can be shared. The account
 * is loaded by id (`GET /api/members/:id`), never found inside the whole list,
 * so a member beyond the first page of Miembros opens the same way.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { BackLink, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { ApiClientError, fetchMember } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import StudentMembershipActions from "@/app/members/StudentMembershipActions";
import type { MemberAccount } from "@/app/members/members-utils";

type LoadState =
  | { status: "loading" }
  | { status: "notFound" }
  | { status: "error"; message: string }
  | { status: "ready"; account: MemberAccount };

export default function MemberPaymentsPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { session, isLoading } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Only the latest request may write state: a slow answer for a previous id
  // (or an older refresh) must not overwrite the member now on screen.
  const latest = useRef(0);

  // `silent` refreshes after a write WITHOUT swapping the page for a spinner,
  // which would unmount the form the admin is still looking at.
  const load = useCallback(
    async ({ silent = false } = {}): Promise<void> => {
      const request = ++latest.current;
      if (!silent) setState({ status: "loading" });
      try {
        const account = await fetchMember(id);
        if (request === latest.current) setState({ status: "ready", account });
      } catch (err) {
        if (request !== latest.current) return;
        if (err instanceof ApiClientError && err.status === 404) {
          setState({ status: "notFound" });
        } else if (!silent) {
          setState({ status: "error", message: toUserMessage(err, "No se pudieron cargar los pagos de este miembro.") });
        }
        // A failed silent refresh keeps what is on screen; the write itself succeeded.
      }
    },
    [id],
  );

  // Same gate as Miembros: only fetch once the role is resolved as admin, so a
  // non-admin is redirected by `ProtectedRoute` before any request is made.
  const isAdmin = !isLoading && session?.user?.role === "admin";
  useEffect(() => {
    if (!isAdmin) return;
    void load();
  }, [isAdmin, load]);

  const refresh = (): void => void load({ silent: true });
  const account = state.status === "ready" ? state.account : null;

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        back={<BackLink href="/members" />}
        title="Pagos"
      >
        {state.status === "loading" && <LoadingState label="Cargando pagos…" />}
        {state.status === "error" && (
          <ErrorState title="No se pudieron cargar los pagos" message={state.message} onRetry={() => void load()} />
        )}
        {state.status === "notFound" && (
          <EmptyState
            title="No encontramos a este miembro"
            description="Puede que el enlace sea incorrecto o que ya no exista. Vuelve a Miembros y búscalo de nuevo."
          />
        )}
        {account && (
          <div className="grid gap-section">
            {account.estudiantes.map((student) => (
              <section key={student.id} className="grid gap-section">
                <StudentMembershipActions
                  personaId={Number(student.id)}
                  student={student}
                  onMembershipCreated={refresh}
                  onDebtRegularized={refresh}
                  onMembresiaChanged={refresh}
                  onPaymentRegistered={refresh}
                />
              </section>
            ))}
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
