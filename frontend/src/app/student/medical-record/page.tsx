/**
 * /student/medical-record — an ADULT titular's access to their OWN medical
 * record.
 *
 * ## The decision this closes (half of FIC-3 in the QA audit)
 *
 * FIC-3 found that a self-managed alumno never saw their own ficha médica.
 * The owner's ruling was partial, not a blanket opening: an adult titular
 * gets in, a minor with their own account does not — the record carries an
 * `enfermedades` field, and a family may not have told a minor everything on
 * it yet. Backend authority for the split lives in
 * `ficha_medica_router.py::_es_titular_mayor_de_edad`, which the
 * `PoliticaAccesoPersona.exigir_acceso` call on GET/PATCH
 * `/fichas-medicas/persona/{id}` now consults per-request. This screen never
 * re-implements that check — it only calls the same endpoints, for the
 * SESSION's own persona id, and leans on the 403 the backend already gives a
 * minor who reaches it anyway.
 *
 * ## Why this reuses `MedicalRecordEditor` unchanged
 *
 * Same reasoning as `/members`' admin screen: the editor takes a bare
 * `personaId` and calls the same `fetchFichaMedica`/`actualizarFichaMedica`
 * client functions regardless of caller role. A second implementation here
 * would be a second place for the five fields (`enfermedades`, `alergias`,
 * `contactoEmergencia`, `telefonoEmergencia`, `tipoSangre`) to drift out of
 * sync with what the API actually saves.
 *
 * ## Why this is `allowedRoles={["estudiante"]}`, no picker
 *
 * Unlike `/student/payments` and `/student/attendance`, this screen is not
 * for a representante managing a dependent — a guardian's access to a
 * REPRESENTADO's ficha médica is a separate, unrelated grant (their own
 * `representante_id` link, not their own age). There is exactly one persona
 * this screen can ever show: the session's own, so there is no
 * `ManagedStudentPicker` here.
 *
 * ## Defense in depth against a minor typing the URL directly
 *
 * The nav entry (`getNavLinksForRole` in `src/lib/auth-utils.ts`) already
 * hides this destination from a minor `estudiante` session. A minor who
 * reaches the URL anyway is redirected to `/student` the moment the portal
 * fetch resolves, the same way `ProtectedRoute` redirects a disallowed role
 * — the backend would 403 the ficha médica call regardless
 * (`test_el_titular_menor_de_edad_no_lee_su_propia_ficha_medica`), so this
 * just avoids surfacing that 403 raw.
 *
 * ## Merge note — collision with feat/ficha-medica-representante
 *
 * That branch (not yet merged as of this one) mounts a DIFFERENT
 * representante-only screen at this same route, with a `ManagedStudentPicker`
 * over `data.representados`. Combining both means one page that branches on
 * `session.user.role`: a `representante` gets the picker over their
 * representados (that branch's `MedicalRecordView`), an ADULT `estudiante`
 * gets their own record directly (this file's content, no picker), and a
 * MINOR `estudiante` never reaches either — see that branch's own
 * `allowedRoles={["representante"]}` note, which needs widening to
 * `["representante", "estudiante"]` with the age gate kept INSIDE the
 * component (ProtectedRoute's role check alone cannot express "estudiante,
 * but only if adult").
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { fetchStudentPortal } from "@/services/api";
import type { StudentPortalSummary } from "@/services/api";
import { ErrorState, LoadingState } from "@/components/ui";
import MedicalRecordEditor from "@/app/members/MedicalRecordEditor";
import { isMinor } from "../student-utils";
import { toUserMessage } from "@/lib/error-message";

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function StudentOwnMedicalRecordContent(): React.ReactElement | null {
  const { session } = useAuth();
  const router = useRouter();
  const personaId = session?.user.id ?? "";

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchStudentPortal(personaId)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: toUserMessage(error, "No se pudo cargar la información."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  const selfIsMinor = state.status === "ready" && isMinor(state.data.self?.fechaNacimiento);

  // See the file header's "Defense in depth" note — the nav already hides
  // this destination from a minor, this is the route-level backstop.
  useEffect(() => {
    if (selfIsMinor) router.replace("/student");
  }, [selfIsMinor, router]);

  if (selfIsMinor) return null;

  return (
    <AppShell
      title="Ficha médica"
      subtitle="Consulte y corrija sus propios datos de salud."
    >
      {state.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando su cuenta…" />
        </div>
      )}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {state.status === "ready" && state.data.self && (
        <MedicalRecordEditor personaId={Number(state.data.self.personaId)} />
      )}
      {state.status === "ready" && !state.data.self && (
        <ErrorState
          message="No se pudo cargar su perfil. Intente de nuevo en unos minutos."
          onRetry={() => setReloadToken((n) => n + 1)}
        />
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StudentOwnMedicalRecordPage(): React.ReactElement {
  return (
    // "estudiante"-only — see the file header for why "representante" is not
    // in this list, and for the merge note with the sibling branch that
    // mounts a representante-only screen at the same route.
    <ProtectedRoute allowedRoles={["estudiante"]}>
      <StudentOwnMedicalRecordContent />
    </ProtectedRoute>
  );
}
