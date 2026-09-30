"use client";

import { useState } from "react";
import ReportProblemDialog from "@/components/ReportProblemDialog";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const requestId = "requestId" in error && typeof error.requestId === "string" ? error.requestId : undefined;
  return (
    <section className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">Algo salió mal</h1>
      <p className="mt-3">Puedes intentarlo de nuevo o avisar al club.</p>
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={reset}>Reintentar</button>
        <button type="button" onClick={() => setOpen(true)}>Reportar un problema</button>
      </div>
      {open && <ReportProblemDialog onClose={() => setOpen(false)} requestId={requestId} />}
    </section>
  );
}
