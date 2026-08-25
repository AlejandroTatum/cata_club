import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/server/auth";
import { passthroughBackendError } from "@/lib/server/backend-client";

export const dynamic = "force-dynamic";

function isPublicSchedules(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((category) => {
    if (typeof category !== "object" || category === null) return false;
    const { category: label, blocks } = category as { category?: unknown; blocks?: unknown };
    if (typeof label !== "string" || !Array.isArray(blocks)) return false;
    return blocks.every((block) => {
      if (typeof block !== "object" || block === null) return false;
      const { days, startTime, endTime } = block as {
        days?: unknown;
        startTime?: unknown;
        endTime?: unknown;
      };
      return (
        Array.isArray(days) &&
        days.every((day) => typeof day === "string") &&
        typeof startTime === "string" &&
        typeof endTime === "string"
      );
    });
  });
}

export async function GET(): Promise<NextResponse> {
  const result = await backendFetch("/asistencias/horarios-publicos", { method: "GET" });
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudieron cargar los horarios." }, { status: 503 });
  }
  if (!result.data.ok) {
    return passthroughBackendError(result.data, "No se pudieron cargar los horarios.");
  }

  try {
    const payload: unknown = await result.data.json();
    if (!isPublicSchedules(payload)) {
      return NextResponse.json({ message: "La respuesta de horarios no es válida." }, { status: 502 });
    }
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ message: "La respuesta de horarios no es válida." }, { status: 502 });
  }
}
