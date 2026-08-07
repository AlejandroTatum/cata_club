/**
 * Mock attendance data — used by attendance-utils tests.
 *
 * Shapes match AttendanceRecord from attendance-utils.
 */

export interface MockAttendanceRecord {
  id: string;
  fecha: string;
  horario: string;
  horarioId: number;
  personaId: number;
  estudiante: string;
  estado: "present" | "absent" | "late" | "justified";
}

export const MOCK_ATTENDANCE_RECORDS: MockAttendanceRecord[] = [
  { id: "att-1", fecha: "2026-07-01", horario: "Lunes 15:00", horarioId: 1, personaId: 1, estudiante: "Ana López", estado: "present" },
  { id: "att-2", fecha: "2026-07-01", horario: "Lunes 15:00", horarioId: 1, personaId: 2, estudiante: "Luis Ramírez", estado: "absent" },
  { id: "att-3", fecha: "2026-07-01", horario: "Lunes 15:00", horarioId: 1, personaId: 3, estudiante: "María García", estado: "justified" },
  { id: "att-4", fecha: "2026-07-01", horario: "Martes 16:00", horarioId: 2, personaId: 4, estudiante: "Carlos Pérez", estado: "present" },
  { id: "att-5", fecha: "2026-07-01", horario: "Martes 16:00", horarioId: 2, personaId: 5, estudiante: "Sofía Flores", estado: "late" },
  { id: "att-6", fecha: "2026-07-01", horario: "Miércoles 17:00", horarioId: 3, personaId: 6, estudiante: "Pedro Sánchez", estado: "present" },
];
