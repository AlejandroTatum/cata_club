/**
 * /student/medical-record — the representante's access to a representado's
 * medical record.
 *
 * ## The finding this closes (FIC-4 in the QA audit)
 *
 * The backend already authorized this: `PoliticaAccesoPersona.exigir_acceso`
 * on `GET`/`PATCH /fichas-medicas/persona/{id}` accepts the ADMINISTRADOR or
 * the representative of that exact persona (`ficha_medica_router.py`). What
 * was missing was a screen — `MedicalRecordEditor` lived only under
 * `app/members/`, admin territory, and no route under `app/student/**`
 * imported it. A family had no way to correct a child's medical record; the
 * `/ayuda` FAQ said so outright ("no: la ficha médica la gestiona un
 * administrador"), and that sentence is now the thing this screen makes
 * false — see `app/ayuda/faq-content.ts`.
 *
 * ## Why this reuses `MedicalRecordEditor` unchanged
 *
 * The editor takes a bare `personaId` and calls the same
 * `fetchFichaMedica`/`actualizarFichaMedica` client functions the admin
 * screen calls. Nothing in it assumes an admin caller — the ROLE distinction
 * lives entirely in the backend's `PoliticaAccesoPersona` check, which this
 * screen leans on rather than re-implements. A second editor here would be a
 * second place for the five fields (`enfermedades`, `alergias`,
 * `contactoEmergencia`, `telefonoEmergencia`, `tipoSangre`) to drift out of
 * sync with what the API actually saves — see the bug this product already
 * had once, where three of five silently never left the client.
 *
 * ## Why this is `allowedRoles={["representante"]}`, unlike its siblings
 *
 * `/student/payments` and `/student/attendance` allow
 * `["representante", "estudiante", "unsupported"]`, because a self-managed
 * student has payments and attendance of their own to look at. A self-managed
 * student has no medical record to look at HERE: the backend's
 * `incluir_titular=False` (`ficha_medica_router.py`) still excludes the
 * titular's own record from this endpoint — enabling that is a separate,
 * not-yet-made product decision (see `test_el_titular_no_lee_su_propia_ficha_medica`
 * in `backend/tests/test_ficha_medica_representante.py`). Routing an
 * "estudiante" account here would only hand it a 403 with nothing to explain
 * it — the honest thing is to not offer the destination at all, in the nav
 * (`getNavLinksForRole`) AND at the route.
 *
 * ## The family-isolation guarantee
 *
 * This screen never decides who may see whose record — it always asks the
 * backend, by calling the exact same authorized endpoints the admin screen
 * calls, for whichever `personaId` `ManagedStudentPicker` resolves. It cannot
 * select a `personaId` outside `data.representados`, because the picker's
 * options ARE that list; and even a hand-edited `?alumno=` in the address bar
 * changes only which of the caller's OWN representados is selected — see
 * `useManagedProfiles`, which ignores a param that does not name one of the
 * account's own profiles. A stranger's `personaId` typed into the URL is not
 * a shortcut around that: it never reaches `ManagedStudentPicker`'s selection
 * at all, and even if it somehow reached `MedicalRecordEditor` directly, the
 * backend would still 403 it — the same guarantee `/members` relies on for
 * the admin screen.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { fetchStudentPortal } from "@/services/api";
import type { StudentPortalSummary } from "@/services/api";
import { EmptyState, ErrorState, LoadingState, buttonClasses } from "@/components/ui";
import MedicalRecordEditor from "@/app/members/MedicalRecordEditor";
import ManagedStudentPicker, { useManagedProfiles } from "../ManagedStudentPicker";
import { firstNameOf } from "../student-utils";
import { Stethoscope } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

// ---------------------------------------------------------------------------
// Content — the picker, then the reused editor
// ---------------------------------------------------------------------------

function MedicalRecordView({
  data,
  accountPersonaId,
}: {
  data: StudentPortalSummary;
  /** The persona behind the SESSION — the storage scope for the picker. */
  accountPersonaId: string;
}): React.ReactElement {
  // `hasAlumnoRole` is hard-coded `false`, not read from the session: a
  // representante account that ALSO holds ALUMNO (a parent who trains
  // themselves) still has no medical record of their OWN reachable here — the
  // backend's `incluir_titular=False` applies to every titular, representante
  // or not. Passing `false` keeps `data.self` out of `managedProfiles`
  // unconditionally, so this screen can never offer a destination the
  // backend would 403.
  const { managedProfiles, selectedId, setSelectedId, selectedProfile } = useManagedProfiles(
    data,
    false,
    accountPersonaId,
  );

  if (selectedProfile === null) {
    return (
      <EmptyState
        icon={<Stethoscope size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron estudiantes asociados a esta cuenta"
        description="Agregue un hijo o dependiente para ver y corregir su ficha médica."
        action={
          <Link href="/student/add-dependent" className={buttonClasses("secondary", "sm")}>
            Agregar hijo o dependiente
          </Link>
        }
      />
    );
  }

  const studentName = firstNameOf(selectedProfile.nombres);

  return (
    <>
      <ManagedStudentPicker
        id="student-select-medical-record"
        profiles={managedProfiles}
        value={selectedId}
        onChange={setSelectedId}
      />

      {/* Names whose record is on screen — `MedicalRecordEditor`'s own
          heading below just says "Ficha médica", which a guardian reading two
          children's records one click apart cannot tell apart on its own. */}
      <section className="card p-5" aria-label={`Ficha médica de ${studentName}`}>
        <h2 className="text-base font-bold tracking-tight text-ink">
          Ficha médica de {studentName}
        </h2>
        <p className="mt-1 text-sm text-ink-3">
          Alergias, enfermedades, tipo de sangre y contacto de emergencia. Los cambios se guardan
          de inmediato.
        </p>
      </section>

      {/* The reused admin editor — see the file header for why this is not a
          second implementation. `key` forces a fresh mount per persona, so
          its internal state (the blood-type default, the form fields) never
          carries over from the previous child when the picker switches. */}
      <MedicalRecordEditor key={selectedProfile.personaId} personaId={Number(selectedProfile.personaId)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function StudentMedicalRecordContent(): React.ReactElement {
  const { session } = useAuth();
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

  return (
    <AppShell
      title="Ficha médica"
      subtitle="Consulte y corrija los datos de salud de cada hijo o dependiente a su cargo."
    >
      {state.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando su cuenta…" />
        </div>
      )}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {state.status === "ready" && (
        <MedicalRecordView data={state.data} accountPersonaId={personaId} />
      )}
    </AppShell>
  );
}

export default function StudentMedicalRecordPage(): React.ReactElement {
  return (
    // Representante-only — see the file header for why this list is shorter
    // than `/student/payments` and `/student/attendance`'s.
    <ProtectedRoute allowedRoles={["representante"]}>
      {/* `useManagedProfiles` reads `?alumno=` through `useSearchParams` —
          the same boundary `/student`, `/student/payments` and
          `/student/attendance` use for the same reason. */}
      <Suspense>
        <StudentMedicalRecordContent />
      </Suspense>
    </ProtectedRoute>
  );
}
