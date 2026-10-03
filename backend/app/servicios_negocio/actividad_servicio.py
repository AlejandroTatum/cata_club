"""Lectura de "Actividad del club" (issue #1314): arma las dos respuestas.

Fuentes de cada cifra:
  - Personas que ingresaron: `actividad_usuario` (usuario, día del club,
    franja de 2 h). Una persona cuenta UNA vez por columna y UNA vez por cada
    rol que tiene; el KPI de personas únicas cuenta personas, no roles. El
    administrador no es ninguno de los tres roles de la gráfica y queda fuera.
  - Asistencias: filas de `asistencia` con estado PRESENTE o ATRASADO, por
    `fecha_registro` (el instante en que se anotó). `fecha_entrenamiento` es un
    día, no sirve para las columnas de 2 h; AUSENTE/JUSTIFICADO/... no son una
    asistencia.
  - Pagos: filas de `pago` (cualquier estado: "comprobantes recibidos"), por
    `fecha_registro`.
  - Inscripciones nuevas: altas de `persona`, por `fecha_registro`.
  - Estado del sistema y "Métricas avanzadas": `metrica_instantanea`.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import zip_longest
from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlalchemy import Float, Integer, cast, distinct, extract, func, select, tuple_
from sqlalchemy.orm import Session

from app.dominio.enums import EstadoAsistencia, TipoRol
from app.dominio.modelos import (
    ActividadUsuario, Asistencia, MetricaInstantanea, Pago, Persona, Rol, usuario_rol,
)
from app.infraestructura.actividad import FRANJAS_POR_DIA, HORAS_POR_FRANJA, fecha_y_franja_del_club
from app.infraestructura.colector_metricas import percentil_ms
from app.servicios_negocio.dtos.actividad_schemas import (
    AvanzadasResponse, BaseDeDatos, Colas, ConteoPorRol, ContenedorMemoria, EndpointLento, EstadoSistema,
    HostAvanzado, Latencia, MemoriaConSerie, PeriodoResumen, RangoAvanzadas, RangoResumen, RedisMemoria,
    ResumenResponse, RuntimeAvanzado, Serie, ServicioAvanzado, SesionesPorRol, UsuariosAvanzado,
    VisitantesUnicos,
)
from app.soporte_transversal.tiempo import ZONA_HORARIA_CLUB

ROL_A_COLUMNA = {
    TipoRol.ALUMNO: "alumnos",
    TipoRol.ENTRENADOR: "entrenadores",
    TipoRol.REPRESENTANTE: "representantes",
}
ASISTENCIAS_QUE_CUENTAN = (EstadoAsistencia.PRESENTE, EstadoAsistencia.ATRASADO)

# --- Umbrales del estado del sistema ---------------------------------------
# Espejan `activity-utils.ts` del frontend (la pantalla pinta con estos mismos
# cortes en "Métricas avanzadas"): ok por debajo de `warn`, warn desde `warn`,
# bad desde `bad`.
LIMITES_CAPACIDAD = (80, 90)        # % de las conexiones de base
LIMITES_ERROR_5XX = (1, 5)          # % de peticiones con error de servidor
LIMITES_P95_MS = (800, 1500)
LIMITES_EDAD_NOTIFICACION_MIN = (30, 120)
VENTANA_ESTADO = timedelta(minutes=15)
# Sin lectura nueva en este tiempo el colector (o el backend, que él scrapea)
# no está funcionando: el estado de la app es urgente, el resto se desconoce.
MAX_EDAD_INSTANTANEA = timedelta(minutes=5)

# --- Avanzadas ---------------------------------------------------------------
PLAN_AVANZADAS: dict[str, tuple[int, int]] = {"1h": (60, 1), "24h": (24, 60), "7d": (28, 360)}  # puntos, minutos por punto
MIN_PETICIONES_RUTA = 5
MAX_RUTAS_LENTAS = 5
_ORDEN_NIVEL = {"ok": 0, "warn": 1, "bad": 2}


def _nivel(valor: float, limites: tuple[int, int]) -> str:
    if valor >= limites[1]:
        return "bad"
    return "warn" if valor >= limites[0] else "ok"


def _iso(instante: datetime) -> str:
    return instante.astimezone(ZONA_HORARIA_CLUB).isoformat()


def _inicio_de_dia(dia: date) -> datetime:
    return datetime.combine(dia, time(), tzinfo=ZONA_HORARIA_CLUB)


@dataclass(frozen=True)
class VentanaResumen:
    span: str
    inicios: list[datetime]
    ancho: timedelta


def ventana_resumen(rango: str, ahora: datetime) -> VentanaResumen:
    local = ahora.astimezone(ZONA_HORARIA_CLUB)
    hoy = local.date()
    if rango == "24h":
        franja_actual = _inicio_de_dia(hoy) + timedelta(hours=(local.hour // HORAS_POR_FRANJA) * HORAS_POR_FRANJA)
        ancho = timedelta(hours=HORAS_POR_FRANJA)
        return VentanaResumen("2h", [franja_actual - ancho * (FRANJAS_POR_DIA - 1 - i) for i in range(FRANJAS_POR_DIA)], ancho)
    if rango == "7d":
        return VentanaResumen("1d", [_inicio_de_dia(hoy - timedelta(days=6 - i)) for i in range(7)], timedelta(days=1))
    return VentanaResumen("6d", [_inicio_de_dia(hoy - timedelta(days=29 - 6 * i)) for i in range(5)], timedelta(days=6))


class ActividadServicio:
    def __init__(self, db: Session) -> None:
        self.db = db

    # =================== Resumen ===================================================
    def resumen(self, rango: RangoResumen, ahora: datetime) -> ResumenResponse:
        ventana = ventana_resumen(rango, ahora)
        n = len(ventana.inicios)
        visitantes = self._visitantes_por_periodo(rango, ventana)
        asistencias = self._conteo_por_periodo(
            Asistencia.fecha_registro, ventana, Asistencia.estado.in_(ASISTENCIAS_QUE_CUENTAN),
        )
        pagos = self._conteo_por_periodo(Pago.fecha_registro, ventana)
        inscripciones = self._conteo_por_periodo(Persona.fecha_registro, ventana)
        periodos = [
            PeriodoResumen(
                start=_iso(ventana.inicios[i]),
                visitors=ConteoPorRol(**visitantes.get(i, {"alumnos": 0, "entrenadores": 0, "representantes": 0})),
                attendances=asistencias.get(i, 0),
                payments=pagos.get(i, 0),
                enrollments=inscripciones.get(i, 0),
            )
            for i in range(n)
        ]
        return ResumenResponse(
            range=rango,
            generatedAt=_iso(ahora),
            span=ventana.span,
            periods=periodos,
            uniqueVisitors=self._visitantes_unicos(rango, ventana),
            status=self._estado_del_sistema(ahora),
        )

    @staticmethod
    def _condicion_de_rango(rango: str, ventana: VentanaResumen):
        f0, franja0 = fecha_y_franja_del_club(ventana.inicios[0])
        if rango == "24h":
            return tuple_(ActividadUsuario.fecha, ActividadUsuario.franja) >= tuple_(f0, franja0), f0, franja0
        return ActividadUsuario.fecha >= f0, f0, franja0

    def _visitantes_por_periodo(self, rango: str, ventana: VentanaResumen) -> dict[int, dict[str, int]]:
        condicion, f0, franja0 = self._condicion_de_rango(rango, ventana)
        dias = cast(ActividadUsuario.fecha - f0, Integer)
        if rango == "24h":
            posicion = dias * FRANJAS_POR_DIA + ActividadUsuario.franja - franja0
        elif rango == "7d":
            posicion = dias
        else:
            posicion = func.floor(cast(dias, Float) / 6)
        columna = posicion.label("posicion")
        filas = self.db.execute(
            select(columna, Rol.tipo_rol, func.count(distinct(ActividadUsuario.usuario_id)))
            .join(usuario_rol, usuario_rol.c.usuario_id == ActividadUsuario.usuario_id)
            .join(Rol, Rol.id == usuario_rol.c.rol_id)
            .where(condicion, Rol.tipo_rol.in_(list(ROL_A_COLUMNA)))
            .group_by(columna, Rol.tipo_rol)
        ).all()
        resultado: dict[int, dict[str, int]] = {}
        for posicion_i, tipo, cantidad in filas:
            i = int(posicion_i)
            if 0 <= i < len(ventana.inicios):
                resultado.setdefault(i, {"alumnos": 0, "entrenadores": 0, "representantes": 0})[ROL_A_COLUMNA[tipo]] = cantidad
        return resultado

    def _visitantes_unicos(self, rango: str, ventana: VentanaResumen) -> VisitantesUnicos:
        condicion, _, _ = self._condicion_de_rango(rango, ventana)
        por_rol = dict(
            self.db.execute(
                select(Rol.tipo_rol, func.count(distinct(ActividadUsuario.usuario_id)))
                .join(usuario_rol, usuario_rol.c.usuario_id == ActividadUsuario.usuario_id)
                .join(Rol, Rol.id == usuario_rol.c.rol_id)
                .where(condicion, Rol.tipo_rol.in_(list(ROL_A_COLUMNA)))
                .group_by(Rol.tipo_rol)
            ).all()
        )
        total = self.db.execute(
            select(func.count(distinct(ActividadUsuario.usuario_id)))
            .join(usuario_rol, usuario_rol.c.usuario_id == ActividadUsuario.usuario_id)
            .join(Rol, Rol.id == usuario_rol.c.rol_id)
            .where(condicion, Rol.tipo_rol.in_(list(ROL_A_COLUMNA)))
        ).scalar_one()
        return VisitantesUnicos(
            alumnos=por_rol.get(TipoRol.ALUMNO, 0),
            entrenadores=por_rol.get(TipoRol.ENTRENADOR, 0),
            representantes=por_rol.get(TipoRol.REPRESENTANTE, 0),
            total=total,
        )

    def _conteo_por_periodo(self, columna, ventana: VentanaResumen, *condiciones) -> dict[int, int]:
        inicio = ventana.inicios[0]
        fin = ventana.inicios[-1] + ventana.ancho
        posicion = func.floor(extract("epoch", columna - inicio) / ventana.ancho.total_seconds()).label("posicion")
        filas = self.db.execute(
            select(posicion, func.count())
            .where(columna >= inicio, columna < fin, *condiciones)
            .group_by(posicion)
        ).all()
        return {int(i): n for i, n in filas if 0 <= int(i) < len(ventana.inicios)}

    # =================== Estado del sistema ===========================================
    def _estado_del_sistema(self, ahora: datetime) -> list[EstadoSistema]:
        def estados(app: str, errores: str, notificaciones: str) -> list[EstadoSistema]:
            return [
                EstadoSistema(key="app", level=app),
                EstadoSistema(key="errors", level=errores),
                EstadoSistema(key="notifications", level=notificaciones),
            ]

        ultima = self.db.scalars(
            select(MetricaInstantanea).order_by(MetricaInstantanea.capturada_en.desc()).limit(1)
        ).first()
        if ultima is None:
            return estados("unknown", "unknown", "unknown")
        if ahora - ultima.capturada_en > MAX_EDAD_INSTANTANEA:
            return estados("bad", "unknown", "unknown")

        desde = ahora - VENTANA_ESTADO
        peticiones, errores_5xx = self.db.execute(
            select(func.sum(MetricaInstantanea.peticiones), func.sum(MetricaInstantanea.errores_5xx))
            .where(MetricaInstantanea.capturada_en >= desde)
        ).one()
        buckets = self._sumar_latencia(MetricaInstantanea.capturada_en >= desde)

        niveles_app = []
        p95 = percentil_ms(buckets, 0.95) if buckets else None
        if p95 is not None:
            niveles_app.append(_nivel(p95, LIMITES_P95_MS))
        if ultima.db_conexiones is not None and ultima.db_conexiones_max:
            niveles_app.append(_nivel(100 * ultima.db_conexiones / ultima.db_conexiones_max, LIMITES_CAPACIDAD))
        app = max(niveles_app, key=_ORDEN_NIVEL.get, default="ok")

        if peticiones is None:
            errores = "unknown"
        else:
            errores = _nivel(100 * (errores_5xx or 0) / peticiones, LIMITES_ERROR_5XX) if peticiones else "ok"

        if ultima.outbox_mas_antiguo_s is None:
            notificaciones = "unknown"
        else:
            notificaciones = _nivel(ultima.outbox_mas_antiguo_s / 60, LIMITES_EDAD_NOTIFICACION_MIN)
        return estados(app, errores, notificaciones)

    def _sumar_latencia(self, *condiciones) -> list[int]:
        total: list[int] = []
        for (fila,) in self.db.execute(
            select(MetricaInstantanea.latencia_buckets).where(MetricaInstantanea.latencia_buckets.isnot(None), *condiciones)
        ):
            # `isnot(None)` solo descarta el NULL de SQL: un JSON `null` (u otro
            # valor que no sea un arreglo de enteros) llega acá y se ignora.
            if not isinstance(fila, list) or not all(
                isinstance(n, int) and not isinstance(n, bool) for n in fila
            ):
                continue
            total = list(fila) if not total else [a + b for a, b in zip_longest(total, fila, fillvalue=0)]
        return total

    # =================== Avanzadas ========================================================
    def avanzadas(self, rango: RangoAvanzadas, ahora: datetime) -> AvanzadasResponse:
        puntos, paso_min = PLAN_AVANZADAS[rango]
        inicio = ahora - timedelta(minutes=puntos * paso_min)
        en_rango = (MetricaInstantanea.capturada_en >= inicio, MetricaInstantanea.capturada_en <= ahora)
        ultima = self.db.scalars(
            select(MetricaInstantanea).where(*en_rango).order_by(MetricaInstantanea.capturada_en.desc()).limit(1)
        ).first()
        if ultima is None:
            return AvanzadasResponse(range=rango, service=None, host=None, runtime=None, users=None)

        series = self._series(inicio, ahora, puntos, paso_min)
        return AvanzadasResponse(
            range=rango,
            service=self._servicio(ultima, series, paso_min, en_rango),
            host=self._host(series, paso_min, en_rango),
            runtime=self._runtime(ultima, en_rango),
            users=self._usuarios(ultima, en_rango),
        )

    def _series(self, inicio: datetime, ahora: datetime, puntos: int, paso_min: int) -> dict[str, list[Optional[float]]]:
        m = MetricaInstantanea
        posicion = func.least(
            puntos - 1, func.floor(extract("epoch", m.capturada_en - inicio) / (paso_min * 60))
        ).label("posicion")
        filas = self.db.execute(
            select(
                posicion,
                func.sum(m.peticiones),
                func.sum(m.intervalo_s).filter(m.peticiones.isnot(None)),
                func.sum(m.errores_5xx),
                func.sum(m.errores_4xx),
                func.avg(m.host_cpu_pct),
                func.avg(m.host_ram_usada_mb),
                func.avg(m.host_swap_usada_mb),
                func.avg(m.host_disco_pct),
            )
            .where(m.capturada_en >= inicio, m.capturada_en <= ahora)
            .group_by(posicion)
        ).all()
        nombres = ("rpm", "e5xx", "e4xx", "cpu", "ram", "swap", "disco")
        series: dict[str, list[Optional[float]]] = {nombre: [None] * puntos for nombre in nombres}
        for pos, peticiones, intervalo, e5, e4, cpu, ram, swap, disco in filas:
            i = int(pos)
            if peticiones is not None and intervalo:
                series["rpm"][i] = round(float(peticiones) / float(intervalo) * 60, 2)
                series["e5xx"][i], series["e4xx"][i] = _tasa(e5, peticiones), _tasa(e4, peticiones)
            for nombre, valor in (("cpu", cpu), ("ram", ram), ("swap", swap), ("disco", disco)):
                series[nombre][i] = None if valor is None else round(float(valor), 1)
        return series

    def _servicio(self, ultima, series, paso_min, en_rango) -> ServicioAvanzado:
        def serie(nombre: str) -> Serie:
            return Serie(stepMinutes=paso_min, values=series[nombre])

        total = self._sumar_latencia(*en_rango)
        latencia = Latencia(
            **{nombre: _redondear(percentil_ms(total, q) if total else None) for nombre, q in (("p50", 0.5), ("p95", 0.95), ("p99", 0.99))}
        )
        return ServicioAvanzado(
            updatedAt=_iso(ultima.capturada_en),
            requestsPerMinute=serie("rpm"),
            errorRate5xx=serie("e5xx"),
            errorRate4xx=serie("e4xx"),
            latencyMs=latencia,
            slowEndpoints=self._rutas_lentas(en_rango),
        )

    def _rutas_lentas(self, en_rango) -> list[EndpointLento]:
        acumulado: dict[tuple[str, str], list[int]] = {}
        for (rutas,) in self.db.execute(
            select(MetricaInstantanea.rutas).where(MetricaInstantanea.rutas.isnot(None), *en_rango)
        ):
            for item in rutas:
                clave = (item["m"], item["r"])
                previo = acumulado.get(clave)
                acumulado[clave] = list(item["b"]) if previo is None else [a + b for a, b in zip(previo, item["b"])]
        candidatos = [
            EndpointLento(method=metodo, route=ruta, p95Ms=round(percentil_ms(buckets, 0.95) or 0.0, 1), requests=buckets[-1])
            for (metodo, ruta), buckets in acumulado.items()
            if buckets[-1] >= MIN_PETICIONES_RUTA
        ]
        candidatos.sort(key=lambda e: (e.p95Ms, e.requests), reverse=True)
        return candidatos[:MAX_RUTAS_LENTAS]

    def _host(self, series, paso_min, en_rango) -> Optional[HostAvanzado]:
        m = MetricaInstantanea
        fila = self.db.scalars(
            select(m).where(m.host_actualizado_en.isnot(None), *en_rango).order_by(m.capturada_en.desc()).limit(1)
        ).first()
        if fila is None:
            return None

        def serie(nombre: str) -> Serie:
            return Serie(stepMinutes=paso_min, values=series[nombre])

        return HostAvanzado(
            updatedAt=_iso(fila.host_actualizado_en),
            cpuPercent=serie("cpu"),
            memory=MemoriaConSerie(usedMb=fila.host_ram_usada_mb, totalMb=fila.host_ram_total_mb, series=serie("ram")),
            swap=MemoriaConSerie(usedMb=fila.host_swap_usada_mb, totalMb=fila.host_swap_total_mb, series=serie("swap")),
            diskPercent=serie("disco"),
        )

    def _runtime(self, ultima, en_rango) -> RuntimeAvanzado:
        m = MetricaInstantanea
        fila_host = self.db.scalars(
            select(m).where(m.host_contenedores.isnot(None), *en_rango).order_by(m.capturada_en.desc()).limit(1)
        ).first()
        contenedores = [
            ContenedorMemoria(name=c["nombre"], usedMb=c["usado_mb"], limitMb=c["limite_mb"])
            for c in (fila_host.host_contenedores if fila_host else [])
        ]
        minutos = None if ultima.outbox_mas_antiguo_s is None else int(ultima.outbox_mas_antiguo_s // 60)
        return RuntimeAvanzado(
            updatedAt=_iso(ultima.capturada_en),
            containers=contenedores,
            database=BaseDeDatos(connectionsUsed=ultima.db_conexiones, connectionsMax=ultima.db_conexiones_max),
            redis=RedisMemoria(usedMb=_redondear(ultima.redis_usado_mb, 1), maxMb=_redondear(ultima.redis_max_mb, 1)),
            queues=Colas(
                celeryPending=ultima.cola_celery,
                notificationsPending=ultima.outbox_pendientes,
                oldestNotificationMinutes=minutos,
            ),
        )

    def _usuarios(self, ultima, en_rango) -> UsuariosAvanzado:
        m = MetricaInstantanea
        ok, fallidos = self.db.execute(
            select(func.coalesce(func.sum(m.logins_ok), 0), func.coalesce(func.sum(m.logins_fallidos), 0)).where(*en_rango)
        ).one()
        por_rol = ultima.conectados_por_rol
        sesiones = None if por_rol is None else SesionesPorRol(
            admin=por_rol.get(TipoRol.ADMINISTRADOR.value, 0),
            trainer=por_rol.get(TipoRol.ENTRENADOR.value, 0),
            estudiante=por_rol.get(TipoRol.ALUMNO.value, 0),
            representante=por_rol.get(TipoRol.REPRESENTANTE.value, 0),
        )
        return UsuariosAvanzado(
            updatedAt=_iso(ultima.capturada_en),
            connectedNow=ultima.conectados,
            loginsOk=int(ok),
            loginsFailed=int(fallidos),
            sessionsByRole=sesiones,
        )


def _tasa(errores, peticiones) -> float:
    """Porcentaje de errores sobre peticiones; sin peticiones es 0 (hubo
    lectura y nadie pidió nada), no "sin dato"."""
    return round(100 * float(errores or 0) / float(peticiones), 2) if peticiones else 0.0


def _redondear(valor: Optional[float], digitos: int = 0) -> Optional[float]:
    return None if valor is None else round(valor, digitos)
