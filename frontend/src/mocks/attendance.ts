/**
 * Mock attendance data — used by attendance-utils tests.
 *
 * Shapes match AttendanceRecord and ScheduleSlot from attendance-utils.
 */

import type { DiaSemana, NivelTecnico } from "@/types/domain";

export interface MockAttendanceRecord {
  id: string;
  fecha: string;
  horario: string;
  personaId: number;
  estudiante: string;
  estado: "present" | "absent" | "late" | "justified";
  entrenador: string;
}

export const MOCK_ATTENDANCE_RECORDS: MockAttendanceRecord[] = [
  { id: "att-1", fecha: "2026-07-01", horario: "Lunes 15:00", personaId: 1, estudiante: "Ana López", estado: "present", entrenador: "Coach Martinez" },
  { id: "att-2", fecha: "2026-07-01", horario: "Lunes 15:00", personaId: 2, estudiante: "Luis Ramírez", estado: "absent", entrenador: "Coach Martinez" },
  { id: "att-3", fecha: "2026-07-01", horario: "Lunes 15:00", personaId: 3, estudiante: "María García", estado: "justified", entrenador: "Coach Martinez" },
  { id: "att-4", fecha: "2026-07-01", horario: "Martes 16:00", personaId: 4, estudiante: "Carlos Pérez", estado: "present", entrenador: "Coach Torres" },
  { id: "att-5", fecha: "2026-07-01", horario: "Martes 16:00", personaId: 5, estudiante: "Sofía Flores", estado: "late", entrenador: "Coach Torres" },
  { id: "att-6", fecha: "2026-07-01", horario: "Miércoles 17:00", personaId: 6, estudiante: "Pedro Sánchez", estado: "present", entrenador: "Coach Martinez" },
];

export interface MockSchedule {
  id: string;
  diaSemana: DiaSemana;
  horaInicio: string;
  horaFin: string;
  nivel: NivelTecnico;
  cancha: string;
  cupoMaximo: number;
  activo: boolean;
}

export const MOCK_SCHEDULES: MockSchedule[] = [
  { id: "hor-001", diaSemana: "lun", horaInicio: "15:00", horaFin: "16:30", nivel: "principiante", cancha: "Cancha 1", cupoMaximo: 12, activo: true },
  { id: "hor-002", diaSemana: "mar", horaInicio: "16:00", horaFin: "17:30", nivel: "principiante", cancha: "Cancha 2", cupoMaximo: 10, activo: true },
  { id: "hor-003", diaSemana: "mie", horaInicio: "17:00", horaFin: "18:30", nivel: "intermedio", cancha: "Cancha 1", cupoMaximo: 10, activo: true },
  { id: "hor-004", diaSemana: "jue", horaInicio: "15:00", horaFin: "16:30", nivel: "intermedio", cancha: "Cancha 2", cupoMaximo: 12, activo: true },
  { id: "hor-005", diaSemana: "vie", horaInicio: "16:00", horaFin: "17:30", nivel: "avanzado", cancha: "Cancha 1", cupoMaximo: 10, activo: false },
  { id: "hor-006", diaSemana: "lun", horaInicio: "17:00", horaFin: "18:30", nivel: "avanzado", cancha: "Cancha 2", cupoMaximo: 8, activo: true },
  { id: "hor-007", diaSemana: "mar", horaInicio: "15:00", horaFin: "16:30", nivel: "principiante", cancha: "Cancha 1", cupoMaximo: 10, activo: true },
  { id: "hor-008", diaSemana: "jue", horaInicio: "17:00", horaFin: "18:30", nivel: "avanzado", cancha: "Cancha 2", cupoMaximo: 12, activo: true },
];
