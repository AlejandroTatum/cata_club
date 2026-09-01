import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/server/auth";
import { passthroughBackendError } from "@/lib/server/backend-client";

export const dynamic = "force-dynamic";

function isPublicSchedules(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((category) => {
    if (typeof category !== "object" || category === null) return false;
    const { category: label, ages, blocks } = category as { category?: unknown; ages?: unknown; blocks?: unknown };
    if (typeof label !== "string" || !Array.isArray(blocks)) return false;
    // `ages` is the backend's optional orientation label
    // (`PublicScheduleCategoryDTO`, #913): a string, or null/absent when the
    // category publishes none. Named explicitly rather than tolerated by
    // omission — anything else here means the upstream shape moved, and the
    // landing must not render a guess at it.
    if (ages !== undefined && ages !== null && typeof ages !== "string") return false;
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
