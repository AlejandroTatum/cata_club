/**
 * PhotoViewerDialog — the profile photo full size, the way a messaging app
 * shows it: the picture on a dark field, «Cerrar», and «Cambiar foto» for the
 * one thing a person looking at their own photo may want next.
 *
 * Escape and a press on the backdrop close it; Tab stays on its two buttons;
 * focus returns to whatever opened it.
 */

"use client";

import { useEffect, useRef } from "react";
import { Camera, X } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "./ui/Button";
import { useBodyScrollLock } from "./ui/useBodyScrollLock";

export interface PhotoViewerDialogProps {
  open: boolean;
  fotoUrl: string;
  onClose: () => void;
  /** Starts a new upload; the dialog closes first. */
  onChange: () => void;
  /** A photo is already uploading: «Cambiar foto» waits for it. */
  uploading?: boolean;
}

export default function PhotoViewerDialog({
  open,
  fotoUrl,
  onClose,
  onChange,
  uploading = false,
}: PhotoViewerDialogProps): React.ReactElement | null {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  // Read through a ref so the focus effect below runs once per opening: a
  // caller's inline `onClose` is a new function on every render, and re-running
  // the effect would bounce focus to the trigger and back each time.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;

    triggerElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [closeButtonRef.current, changeButtonRef.current].filter(
        (el): el is HTMLButtonElement => el !== null && !el.disabled,
      );
      event.preventDefault();
      const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex =
        (currentIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex]?.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerElementRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-coal/95"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Foto de perfil"
        onClick={(event) => event.stopPropagation()}
        className="m-auto flex w-full max-w-lg flex-col gap-4 px-4 py-6"
      >
        <div className="flex items-center justify-between gap-3 text-white">
          <h2 className="text-sm font-bold uppercase tracking-caps">Foto de perfil</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="touch-target inline-flex items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            <X size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, same as AvatarPhoto */}
        <img
          src={fotoUrl}
          alt="Foto de perfil"
          className="max-h-[70vh] w-full rounded-xl object-contain"
        />
        <button
          ref={changeButtonRef}
          type="button"
          onClick={onChange}
          disabled={uploading}
          className={buttonClasses("onCoal", "md", "self-center")}
        >
          <Camera size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Cambiar foto
        </button>
      </div>
    </div>
  );
}
