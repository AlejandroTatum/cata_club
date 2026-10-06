import { NextRequest, NextResponse } from "next/server";
import { proxyBackendGet } from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const q = searchParams.get("q");
  const rol = searchParams.get("rol");
  const jugador = searchParams.get("jugador");
  const skip = searchParams.get("skip");
  const limit = searchParams.get("limit");
  if (q) qs.set("q", q);
  if (rol) qs.set("rol", rol);
  if (jugador) qs.set("jugador", jugador);
  if (skip) qs.set("skip", skip);
  if (limit) qs.set("limit", limit);
  return proxyBackendGet(request, `/personas/buscar?${qs.toString()}`, "No se pudieron buscar personas.");
}
