/**
 * Roles and account state for one persona — deliberately ONE hook, not two.
 *
 * They look like two independent controls in the edit dialog, and splitting
 * them into two components was the obvious move. It is the wrong one: a single
 * `obtenerRolesDePersona` call answers both, a failed load has to surface in
 * both places, and the dialog HEADER renders `activo` as a badge. Any split
 * would have to lift all of it back up, so the shared thing is modelled as
 * shared.
 *
 * `roles`/`activo` start empty/true only as placeholders — they get overwritten
 * as soon as the fetch resolves. Until then `ready` is false and the callers
 * must keep their controls disabled, so nothing is ever toggled against a stale
 * "no roles yet" placeholder. That mismatch was the original bug: the modal
 * showed every role unchecked, an admin ticked one that the persona already
 * had, and the backend correctly rejected it with a 400.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { asignarRol, cambiarEstadoCuenta, obtenerRolesDePersona, quitarRol } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import type { BackendTipoRol } from "@/types/domain";

/** Shared by the toast copy and the role checkboxes' labels. */
export const ROLE_LABELS: Record<BackendTipoRol, string> = {
  ADMINISTRADOR: "Admin",
  ENTRENADOR: "Entrenador",
  REPRESENTANTE: "Representante",
  ALUMNO: "Alumno",
};

export interface AccountRolesAndStatus {
  roles: BackendTipoRol[];
  activo: boolean;
  /** False while the initial load is in flight or failed — gate every control on it. */
  ready: boolean;
  /** The initial load specifically, so callers can say "Cargando…" rather than just disabling. */
  loading: boolean;
  /** The role whose toggle is currently in flight, if any. */
  roleLoading: BackendTipoRol | null;
  stateLoading: boolean;
  roleError: string | null;
  stateError: string | null;
  toggleRole: (role: BackendTipoRol) => Promise<void>;
  toggleEstado: () => Promise<void>;
}

export function useAccountRolesAndStatus(personaId: number): AccountRolesAndStatus {
  const { showSuccess, showError } = useToast();
  const [roles, setRoles] = useState<BackendTipoRol[]>([]);
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [roleLoading, setRoleLoading] = useState<BackendTipoRol | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setLoaded(false);
    // Clearing here rather than where the dialog opens: this covers switching
    // from one account to another without closing, which the dialog-mount
    // reset never reached because its effect does not depend on the persona.
    setRoleError(null);
    setStateError(null);
    void obtenerRolesDePersona(personaId)
      .then((current) => {
        if (cancelled) return;
        setRoles(current.roles);
        setActivo(current.activo);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = toUserMessage(
          error,
          "No se pudieron cargar los roles y el estado actuales de esta cuenta.",
        );
        // Both, on purpose: one failed request blinds both controls, so the
        // failure has to be visible wherever the reader is looking.
        setRoleError(message);
        setStateError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [personaId]);

  const toggleRole = useCallback(
    async (role: BackendTipoRol): Promise<void> => {
      setRoleLoading(role);
      setRoleError(null);
      const hasRole = roles.includes(role);

      try {
        if (hasRole) {
          await quitarRol(personaId, role);
          setRoles((prev) => prev.filter((r) => r !== role));
          showSuccess(`Rol ${ROLE_LABELS[role]} quitado correctamente.`);
        } else {
          await asignarRol(personaId, role);
          setRoles((prev) => [...prev, role]);
          showSuccess(`Rol ${ROLE_LABELS[role]} asignado correctamente.`);
        }
      } catch (error: unknown) {
        const message = toUserMessage(error, "No se pudo actualizar el rol.");
        // If the backend says the role is already present/absent, reconcile
        // local state. This reads the TRANSLATED message, so it only
        // reconciles while the backend's sentence survives the vocabulary
        // gate — it does today (plain Spanish on a 4xx), but a reworded detail
        // carrying an underscore would silently stop reconciling. The durable
        // fix is a status or an error code the frontend can branch on.
        if (message.toLowerCase().includes("ya tiene el rol")) {
          setRoles((prev) => (prev.includes(role) ? prev : [...prev, role]));
        } else if (message.toLowerCase().includes("no tiene el rol")) {
          setRoles((prev) => prev.filter((r) => r !== role));
        } else {
          setRoleError(message);
          showError(message);
        }
      } finally {
        setRoleLoading(null);
      }
    },
    [personaId, roles, showError, showSuccess],
  );

  const toggleEstado = useCallback(async (): Promise<void> => {
    setStateLoading(true);
    setStateError(null);
    const next = !activo;

    try {
      await cambiarEstadoCuenta(personaId, next);
      setActivo(next);
      showSuccess(next ? "Cuenta activada correctamente." : "Cuenta desactivada correctamente.");
    } catch (error: unknown) {
      const message = toUserMessage(error, "No se pudo cambiar el estado.");
      setStateError(message);
      showError(message);
    } finally {
      setStateLoading(false);
    }
  }, [activo, personaId, showError, showSuccess]);

  return {
    roles,
    activo,
    ready: loaded && !loading,
    loading,
    roleLoading,
    stateLoading,
    roleError,
    stateError,
    toggleRole,
    toggleEstado,
  };
}
