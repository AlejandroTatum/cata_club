"""Respuestas de "Actividad del club" (issue #1314).

Las formas son las del demo aprobado (`frontend/src/app/admin/actividad/
demo-data.ts`: `ResumenData` y `AvanzadasData`), con los nombres en camelCase
tal cual los consume el frontend. A propósito NO usan `ResponseBase`: sus
fechas son cadenas ISO con el offset del CLUB (`-05:00`), no UTC con `Z`, y es
el instante que la pantalla formatea.

Diferencias deliberadas con el demo, todas porque el dato real puede no existir
(y mostrar 0 sería mentir):
  - `status[].level` admite `"unknown"` (sin instantáneas todavía).
  - `service`, `host`, `runtime` y `users` pueden ser `null`.
  - los valores de una `Series` pueden ser `null` (minuto/hora sin lectura).
  - `latencyMs.*`, `redis.maxMb` y `memory/swap` pueden ser `null`.
  - `SlowEndpoint.method` es cualquier método HTTP, no solo GET/POST/PATCH.
Solo agregados: ningún campo identifica a una persona, un host o una versión.
"""
from typing import Literal, Optional

from pydantic import BaseModel

RangoResumen = Literal["24h", "7d", "30d"]
RangoAvanzadas = Literal["1h", "24h", "7d"]
Nivel = Literal["ok", "warn", "bad", "unknown"]


class ConteoPorRol(BaseModel):
    alumnos: int
    entrenadores: int
    representantes: int


class VisitantesUnicos(ConteoPorRol):
    total: int


class PeriodoResumen(BaseModel):
    start: str
    visitors: ConteoPorRol
    attendances: int
    payments: int
    enrollments: int


class EstadoSistema(BaseModel):
    key: Literal["app", "errors", "notifications"]
    level: Nivel


class ResumenResponse(BaseModel):
    range: RangoResumen
    generatedAt: str
    span: Literal["2h", "1d", "6d"]
    periods: list[PeriodoResumen]
    uniqueVisitors: VisitantesUnicos
    status: list[EstadoSistema]


class Serie(BaseModel):
    stepMinutes: int
    values: list[Optional[float]]


class Latencia(BaseModel):
    p50: Optional[float]
    p95: Optional[float]
    p99: Optional[float]


class EndpointLento(BaseModel):
    method: str
    route: str
    p95Ms: float
    requests: int


class ServicioAvanzado(BaseModel):
    updatedAt: str
    requestsPerMinute: Serie
    errorRate5xx: Serie
    errorRate4xx: Serie
    latencyMs: Latencia
    slowEndpoints: list[EndpointLento]


class MemoriaConSerie(BaseModel):
    usedMb: int
    totalMb: int
    series: Serie


class HostAvanzado(BaseModel):
    updatedAt: str
    cpuPercent: Serie
    memory: MemoriaConSerie
    swap: MemoriaConSerie
    diskPercent: Serie


class ContenedorMemoria(BaseModel):
    name: str
    usedMb: int
    limitMb: int


class BaseDeDatos(BaseModel):
    connectionsUsed: Optional[int]
    connectionsMax: Optional[int]


class RedisMemoria(BaseModel):
    usedMb: Optional[float]
    maxMb: Optional[float]


class Colas(BaseModel):
    celeryPending: Optional[int]
    notificationsPending: Optional[int]
    oldestNotificationMinutes: Optional[int]


class RuntimeAvanzado(BaseModel):
    updatedAt: str
    containers: list[ContenedorMemoria]
    database: BaseDeDatos
    redis: RedisMemoria
    queues: Colas


class SesionesPorRol(BaseModel):
    admin: int
    trainer: int
    estudiante: int
    representante: int


class UsuariosAvanzado(BaseModel):
    updatedAt: str
    connectedNow: Optional[int]
    loginsOk: int
    loginsFailed: int
    sessionsByRole: Optional[SesionesPorRol]


class AvanzadasResponse(BaseModel):
    range: RangoAvanzadas
    service: Optional[ServicioAvanzado]
    host: Optional[HostAvanzado]
    runtime: Optional[RuntimeAvanzado]
    users: Optional[UsuariosAvanzado]
