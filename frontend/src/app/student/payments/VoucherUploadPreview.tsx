"use client";

/** Confirm step before an already-registered payment receives its voucher. */

import { Button } from "@/components/ui";
import { formatFileSize } from "./payments-utils";
import { Loader2, Paperclip, Upload } from "lucide-react";
import { ICON } from "@/lib/icon-size";

// ---------------------------------------------------------------------------
// Confirm before the voucher actually uploads (issue #463)
// ---------------------------------------------------------------------------

/**
 * The step between picking a file in the OS dialog and actually sending it:
 * name, size, and the image itself when it is one (a PDF gets a plain
 * attachment icon instead — there is nothing to thumbnail). Nothing here
 * calls the API; `onConfirm`/`onCancel` are the caller's own.
 */
export function VoucherUploadPreview({
  file,
  previewUrl,
  uploading,
  onConfirm,
  onCancel,
}: {
  file: File;
  /** An object URL for `file`, or `null` when it is not an image. */
  previewUrl: string | null;
  uploading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="card flex flex-col gap-3 p-4" role="group" aria-label="Confirmar comprobante antes de subir">
      <div className="flex items-center gap-3">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-ctl object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-ctl bg-sunken">
            <Paperclip size={ICON.lg} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
          <p className="text-xs text-ink-3-strong">{formatFileSize(file.size)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={onConfirm} disabled={uploading}>
          {uploading ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          {uploading ? "Subiendo…" : "Confirmar y subir"}
        </Button>
        <Button size="sm" onClick={onCancel} disabled={uploading}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
