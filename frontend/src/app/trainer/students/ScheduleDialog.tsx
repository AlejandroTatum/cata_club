"use client";

import { useRef } from "react";
import { Clock, X } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { useModalFocusTrap } from "@/lib/focus-trap";

interface ScheduleDialogProps {
  student: { name: string; horarios: string | null } | null;
  onClose: () => void;
}

/** Read-only view of the weekly windows already returned with the roster. */
export default function ScheduleDialog({ student, onClose }: ScheduleDialogProps): React.ReactElement | null {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap({ open: student !== null, onClose, panelRef, initialFocusRef: closeButtonRef });

  if (!student) return null;
  const windows = student.horarios?.split(" · ").filter(Boolean) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-cata-black/40" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-schedule-title"
        className="card relative w-full max-w-md p-0"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Clock size={ICON.base} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id="student-schedule-title" className="text-base font-bold text-ink">Horario</h2>
            <p className="truncate text-xs text-ink-3">{student.name}</p>
          </div>
          <Button ref={closeButtonRef} variant="tertiary" size="sm" onClick={onClose} aria-label="Cerrar horario">
            <X size={ICON.sm} aria-hidden="true" />
          </Button>
        </div>
        {windows.length > 0 ? (
          <ul className="divide-y divide-line px-5 py-2">
            {windows.map((window) => <li key={window} className="py-3 text-sm text-ink">{window}</li>)}
          </ul>
        ) : (
          <EmptyState
            surface="inset"
            icon={<Clock size={ICON.lg} aria-hidden="true" />}
            title="Sin horario disponible"
            description="El padrón no trae una ventana de entrenamiento que se pueda mostrar para esta persona."
          />
        )}
      </div>
    </div>
  );
}
