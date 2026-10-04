"use client";

/**
 * Preview of the proof (comprobante) picked for a transfer, shown before the
 * payment is submitted: a thumbnail for JPG/PNG, a document tile for PDF.
 * The object URL is created here and always revoked, so callers only hand
 * over the `File`.
 */

import { useEffect, useState } from "react";
import { FileText, Paperclip, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { formatFileSize } from "./payments-utils";

export function ProofPreview({
  file,
  onReplace,
  onRemove,
}: {
  file: File;
  onReplace: () => void;
  onRemove: () => void;
}): React.ReactElement {
  const isImage = file.type.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  return (
    <div
      data-testid="renew-proof-preview"
      className="flex items-center gap-3 rounded-ctl border border-line bg-sunken p-2.5"
    >
      {isImage ? (
        url ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, not a remote asset
          <img src={url} alt={`Vista previa de ${file.name}`} className="h-16 w-16 flex-none rounded-ctl border border-line object-cover" />
        ) : (
          <span className="flex h-16 w-16 flex-none items-center justify-center rounded-ctl bg-paper">
            <Paperclip size={ICON.lg} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
          </span>
        )
      ) : (
        <span
          data-testid="renew-proof-pdf-tile"
          className="flex h-16 w-16 flex-none flex-col items-center justify-center gap-0.5 rounded-ctl border border-line bg-paper text-state-bad"
        >
          <FileText size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />
          <span className="text-2xs font-bold uppercase">PDF</span>
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
        <p className="text-xs tabular-nums text-ink-3-strong">{formatFileSize(file.size)}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={onReplace}>
            <RefreshCw size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            Cambiar archivo
          </Button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Quitar el comprobante seleccionado"
            className="inline-flex h-8 items-center gap-1 rounded-ctl px-2 text-xs font-semibold text-ink-2 hover:bg-paper hover:text-state-bad"
          >
            <X size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Quitar
          </button>
        </div>
      </div>
    </div>
  );
}
