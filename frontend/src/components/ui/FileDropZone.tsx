"use client";

/**
 * FileDropZone — one accessible file picker for the admin screens.
 *
 * The native `<input type="file">` renders browser-language chrome ("Choose
 * File / No file chosen"), so it is hidden visually but stays in the DOM under
 * the caller's label: assistive tech and tests still reach the real control.
 * The visible surface is a button that opens the picker (keyboard and pointer)
 * and accepts a dropped file. Validation stays with the caller — the zone only
 * reports what the person chose.
 */

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactElement } from "react";
import { ImagePlus } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { cn } from "./cn";

export interface FileDropZoneProps {
  id: string;
  label: string;
  hint: string;
  accept: string;
  /** The file the caller currently holds; null shows the empty zone. */
  file: File | null;
  onFile: (file: File | null) => void;
  /** Text of the empty-state action, e.g. "Elegir logo". */
  chooseLabel?: string;
  required?: boolean;
  className?: string;
}

export default function FileDropZone({ id, label, hint, accept, file, onFile, chooseLabel = "Elegir foto", required, className }: FileDropZoneProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // The caller owns the file: when it drops it (publish, rejection), the
  // native input must forget it too or re-picking the same file is silent.
  useEffect(() => { if (!file && inputRef.current) inputRef.current.value = ""; }, [file]);

  const open = (): void => inputRef.current?.click();

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>): void {
    event.preventDefault(); setDragging(false);
    onFile(event.dataTransfer.files[0] ?? null);
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-field", className)}>
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <input ref={inputRef} id={id} type="file" accept={accept} aria-required={required || undefined} tabIndex={-1} onChange={handleChange} className="sr-only" />
      <button
        type="button"
        onClick={open}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        data-dragging={dragging}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-card border border-dashed px-4 py-5 text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cata-red",
          dragging ? "border-cata-red bg-sunken" : "border-line-2 bg-paper hover:bg-sunken",
        )}
      >
        {file ? (
          <>
            <span className="max-w-full truncate text-sm font-semibold text-ink">{file.name}</span>
            <span className="text-xs font-semibold text-cata-red">Cambiar</span>
          </>
        ) : (
          <>
            <ImagePlus size={ICON.lg} aria-hidden="true" className="text-ink-2" />
            <span className="text-sm font-semibold text-ink">{chooseLabel}</span>
            <span className="text-xs text-ink-2">o arrástrela aquí</span>
          </>
        )}
      </button>
      <p className="text-xs font-normal text-ink-2">{hint}</p>
    </div>
  );
}
