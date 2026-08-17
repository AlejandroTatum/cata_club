/**
 * /student/medical-record — a family portal screen with TWO grants that
 * share one route, branching on `session.user.role`:
 *
 * - `representante`: the representante's access to a REPRESENTADO's medical
 *   record (FIC-4 in the QA audit) — a picker over `data.representados`,
 *   reusing `MedicalRecordEditor` per selected child.
 * - `estudiante`, ADULT only: the titular's own access to their OWN record
 *   (half of FIC-3 — the owner's ruling was partial: an adult titular gets
 *   in, a minor with their own account does not). No picker: there is
 *   exactly one persona this branch can ever show.
 *
 * ## Why one file, not two routes
 *
 * `feat/ficha-medica-representante` and `feat/ficha-medica-propia` each
 * mounted their own screen at this exact path, on independent branches. The
 * two access grants are unrelated in the backend — a guardian's link to a
 * REPRESENTADO (`representante_id`) has nothing to do with a titular's own
 * age (`ficha_medica_router.py::_es_titular_mayor_de_edad`) — so merging
 * them is purely a routing concern: one path, one component, branching on
 * role. See `docs/archive/fixes/15-ficha-medica-propia.md`'s "Conflicto con
 * feat/ficha-medica-representante" section for the resolution this file
 * carries out.
 *
 * ## Why both branches reuse `MedicalRecordEditor` unchanged
 *
 * The editor takes a bare `personaId` and calls the same
 * `fetchFichaMedica`/`actualizarFichaMedica` client functions regardless of
 * caller role — nothing in it assumes an admin, a representante or a
 * titular. A second implementation per branch would be a second place for
 * the five fields (`enfermedades`, `alergias`, `contactoEmergencia`,
 * `telefonoEmergencia`, `tipoSangre`) to drift out of sync with what the API
 * actually saves.
 *
 * ## Defense in depth against a minor `estudiante` typing the URL directly
 *
 * The nav entry (`getNavGroupsForRoles` in `src/lib/auth-utils.ts`) already
 * hides this destination from a minor `estudiante` session. A minor who
 * reaches the URL anyway is redirected to `/student` the moment the portal
 * fetch resolves — the backend would 403 the ficha médica call regardless
 * (`test_el_titular_menor_de_edad_no_lee_su_propia_ficha_medica`), so this
 * just avoids surfacing that 403 raw. A `representante` session has no such
 * gate: that grant was never age-conditioned.
 *
 * ## The family-isolation guarantee (representante branch)
 *
 * This screen never decides who may see whose record — it always asks the
 * backend, by calling the exact same authorized endpoints the admin screen
 * calls, for whichever `personaId` `ManagedStudentPicker` resolves. It
 * cannot select a `personaId` outside `data.representados`, because the
 * picker's options ARE that list; and even a hand-edited `?alumno=` in the
 * address bar changes only which of the caller's OWN representados is
 * selected — see `useManagedProfiles`, which ignores a param that does not
 * name one of the account's own profiles.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { fetchStudentPortal } from "@/services/api";
import type { StudentPortalSummary } from "@/services/api";
import { EmptyState, ErrorState, LoadingState, buttonClasses } from "@/components/ui";
import MedicalRecordEditor from "@/app/members/MedicalRecordEditor";
import ManagedStudentPicker, { useManagedProfiles } from "../ManagedStudentPicker";
import { firstNameOf, isMinor } from "../student-utils";
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
// Representante branch — the picker, then the reused editor
// ---------------------------------------------------------------------------

function RepresentanteMedicalRecordView({
  data,
  accountPersonaId,
}: {
  data: StudentPortalSummary;
  /** The persona behind the SESSION — the storage scope for the picker. */
  accountPersonaId: string;
}): React.ReactElement {
  // `hasAlumnoRole` is hard-coded `false`, not read from the session: a
  // representante account that ALSO holds ALUMNO (a parent who trains
  // themselves) still has no medical record of their OWN reachable here —
  // that grant belongs to the `estudiante` branch below, and it is age-gated
  // in a way this picker does not express. Passing `false` keeps `data.self`
  // out of `managedProfiles` unconditionally, so this branch can never offer
  // a destination the backend would 403.
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
        // `fill` because this is the page's ONLY block: without it the
        // statement sits at the top of a window whose remaining 600px stay
        // blank, which is the reproche this pass exists to close (D11b).
        fill
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

      {/* D11c: this used to be a card of its own above the editor, and it was
          the third heading in a row naming the same thing — the page's own h1
          says "Ficha médica", the editor's pinned header says it again, and
          this said it a third time with the student's name attached. Its
          paragraph was worse: it restated the page subtitle in different
          words, which is the exact repetition D11c forbids ("ninguna ayuda
          repite el subtítulo: si lo repite, sobra una de las dos").

          What it was actually FOR — telling a guardian which of two children's
          records is on screen — is already done, and done better, by the
          editor's own `sticky` header, because that one survives the fields
          scrolling under it. `studentName` below is what feeds it. */}

      {/* The reused admin editor — see the file header for why this is not a
          second implementation. `key` forces a fresh mount per persona, so
          its internal state (the blood-type default, the form fields) never
          carries over from the previous child when the picker switches. */}
      <MedicalRecordEditor
        key={selectedProfile.personaId}
        personaId={Number(selectedProfile.personaId)}
        studentName={studentName}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function StudentMedicalRecordContent(): React.ReactElement | null {
  const { session } = useAuth();
  const { showInfo } = useToast();
  const router = useRouter();
  const role = session?.user.role;
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

  // See the file header's "Defense in depth" note — the nav already hides
  // this destination from a minor estudiante, this is the route-level
  // backstop. A representante session is never minor-gated: that check is
  // meaningless for a guardian's own access grant.
  const selfIsMinor =
    role === "estudiante" && state.status === "ready" && isMinor(state.data.self?.fechaNacimiento);

  useEffect(() => {
    if (selfIsMinor) {
      // #315 hallazgo #69: this used to redirect in silence — a minor
      // typing the URL landed back on /student with no idea why, the exact
      // same 403 this avoids surfacing but with no explanation at all.
      showInfo(
        "Su ficha médica la corrige su representante o un administrador del club.",
      );
      router.replace("/student");
    }
  }, [selfIsMinor, router, showInfo]);

  if (selfIsMinor) return null;

  const subtitle =
    role === "representante"
      ? "Consulte y corrija los datos de salud de cada hijo o dependiente a su cargo."
      : "Consulte y corrija sus propios datos de salud.";

  return (
    // `measure="short"` (D11b): this screen measured the worst dead air in the
    // product — 57% as an adult titular, 42% as a guardian, at 1440x900 — and
    // it is the one place where that is PURE layout. Five controls that never
    // grow with data were being drawn on `max-w-8xl`, the product's WIDEST
    // measure, for its narrowest content: a 1356px column carrying a 300px
    // form.
    //
    // `short` is the instrument `AppShell` already documents for exactly this
    // shape, and until now only `/discounts` and `/groups` used it. It is
    // honest about what it does: the canvas under the last card does not
    // shrink, the block above it stops reading as a page that ran out of rows.
    // There is nothing else to put here — no history, no trend, no "última
    // actualización" — and inventing one would break D14's own rule.
    <AppShell title="Ficha médica" subtitle={subtitle} measure="short">
      {state.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando su cuenta…" />
        </div>
      )}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {state.status === "ready" && role === "representante" && (
        <RepresentanteMedicalRecordView data={state.data} accountPersonaId={personaId} />
      )}
      {state.status === "ready" && role === "estudiante" && state.data.self && (
        <MedicalRecordEditor
          personaId={Number(state.data.self.personaId)}
          studentName={firstNameOf(state.data.self.nombres)}
        />
      )}
      {state.status === "ready" && role === "estudiante" && !state.data.self && (
        <ErrorState
          message="No se pudo cargar su perfil. Intente de nuevo en unos minutos."
          onRetry={() => setReloadToken((n) => n + 1)}
        />
      )}
    </AppShell>
  );
}

export default function StudentMedicalRecordPage(): React.ReactElement {
  return (
    // Both grants share this route — see the file header for why a
    // representante's access to a REPRESENTADO and an adult estudiante's
    // access to their OWN record are independent and unrelated to each
    // other's condition (a role vs. an age check).
    <ProtectedRoute allowedRoles={["representante", "estudiante"]}>
      {/* `useManagedProfiles` reads `?alumno=` through `useSearchParams` —
          the same boundary `/student`, `/student/payments` and
          `/student/attendance` use for the same reason. */}
      <Suspense>
        <StudentMedicalRecordContent />
      </Suspense>
    </ProtectedRoute>
  );
}
