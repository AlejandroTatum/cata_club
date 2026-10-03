"use client";

import { useReportProblem } from "@/components/report-problem/useReportProblem";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): React.ReactElement {
  const requestId = "requestId" in error && typeof error.requestId === "string" ? error.requestId : undefined;
  const report = useReportProblem(requestId);
  return (
    <section className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">Algo salió mal</h1>
      <p className="mt-3">Puede intentarlo de nuevo o avisar al club.</p>
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={reset}>Reintentar</button>
        <button type="button" onClick={report.open} disabled={report.busy}>Reportar un problema</button>
      </div>
      {report.dialog}
    </section>
  );
}
