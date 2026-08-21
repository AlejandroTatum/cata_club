import ConfirmDialog from "@/components/ConfirmDialog";
import type { PendingConfirmation } from "./useLeaveGuard";

interface AttendanceLeaveDialogProps {
  pendingConfirmation: PendingConfirmation | null;
  reviewedCount: number;
  totalStudents: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The one dialog behind both "leave with unsaved marks" and "discard a
 * resumable draft" — both are the same shape (something will be lost, here
 * is what and how much), so both share the same `ConfirmDialog`.
 */
export default function AttendanceLeaveDialog({
  pendingConfirmation,
  reviewedCount,
  totalStudents,
  onConfirm,
  onCancel,
}: AttendanceLeaveDialogProps): React.ReactElement {
  const isDiscardDraft = pendingConfirmation?.kind === "discard-draft";
  return (
    <ConfirmDialog
      open={pendingConfirmation !== null}
      variant="danger"
      title={isDiscardDraft ? "¿Descartar la lista sin terminar?" : "¿Salir sin registrar la asistencia?"}
      message={
        isDiscardDraft && pendingConfirmation?.kind === "discard-draft"
          ? `Se perderán las ${pendingConfirmation.markCount} marcas de ${pendingConfirmation.label}. Los alumnos volverán a quedar sin revisar.`
          : `Marcó ${reviewedCount} de ${totalStudents} ${totalStudents === 1 ? "alumno" : "alumnos"} y todavía no registró la asistencia. Guardamos el borrador en esta pestaña para que pueda retomarlo, pero si la cierra se pierde.`
      }
      confirmLabel={isDiscardDraft ? "Descartar" : "Salir sin registrar"}
      cancelLabel={isDiscardDraft ? "Conservar" : "Seguir con la lista"}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
