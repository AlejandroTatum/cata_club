/**
 * Placeholder shown while the layout and the session are unknown (REG-17,
 * FAM-25). It reuses the frame's own breakpoints (CSS only, no script), so
 * the box it reserves is the one the wizard fills: the page is never blank
 * and nothing moves when the real form replaces it.
 */
import type { ReactElement } from "react";

export default function EnrollSkeleton(): ReactElement {
  return (
    <div
      data-testid="enroll-skeleton"
      role="status"
      aria-busy="true"
      aria-label="Cargando la inscripción"
      className="auth-shell flex min-h-screen w-full flex-col bg-canvas lg:flex-row"
    >
      <div className="h-40 bg-coal lg:h-screen lg:w-96 lg:flex-none" />
      <div className="flex min-w-0 flex-1 flex-col px-4 py-page lg:justify-center lg:p-10">
        <div className="card flex w-full flex-1 animate-pulse flex-col gap-4 p-page lg:flex-none lg:p-10">
          <div className="h-6 w-1/3 rounded-ctl bg-sunken" />
          <div className="h-ctl rounded-ctl bg-sunken" />
          <div className="h-ctl rounded-ctl bg-sunken" />
          <div className="h-ctl rounded-ctl bg-sunken" />
        </div>
      </div>
    </div>
  );
}
