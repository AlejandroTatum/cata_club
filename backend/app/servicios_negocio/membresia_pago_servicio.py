import calendar
import logging
from uuid import uuid4
from dataclasses import dataclass
from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
from typing import Optional
from sqlalchemy import inspect as inspeccionar_orm
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.modelos import (
    Membresia, TipoMembresia, Pago, ComprobantePago, Notificacion, CoberturaBonificada,
    HistorialEstadoMembresia, CorreccionPago, HistorialCambioPlanMembresia, Persona,
)
from app.dominio.enums import (
    EstadoPago, EstadoMembresia, TipoNotificacion, TipoPago, TipoRol, EfectoCoberturaCorreccion,
)
from app.dominio.periodicidad import PeriodicidadTarifa
from app.dominio.etiquetas import estado_de_pago_en_castellano
from app.dominio.nombres_catalogo import existe_nombre, normalizar_nombre
from app.dominio.excepciones import (
    EntidadNoEncontrada, MembresiaPendienteDePago, NombreDuplicado, OperacionInvalida, PermisosInsuficientes, RecursoEnUso, ServicioNoDisponible,
)
from app.dominio.nombre_propio import nombre_completo
from app.infraestructura.correo_deuda_regularizada import enviar_deuda_regularizada
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.membresia_repositorio import (
    MembresiaRepositorio, TipoMembresiaRepositorio, HistorialEstadoMembresiaRepositorio,
)
from app.infraestructura.repositorios.pago_repositorio import (
    PagoRepositorio, ComprobantePagoRepositorio, CoberturaBonificadaRepositorio,
)
from app.infraestructura.repositorios.descuento_repositorio import (
    AsignacionDescuentoRepositorio, DescuentoRepositorio,
)
from app.infraestructura.repositorios.notificacion_repositorio import NotificacionRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.servicios_negocio.persona_servicio import _calcular_edad
from app.servicios_negocio.politica_acceso import PoliticaAccesoPersona
from app.servicios_negocio.notificacion_servicio import acortar_nombre_para_notificacion
from app.soporte_transversal.formato import formatear_monto_usd
from app.soporte_transversal.firma_archivos import es_contenido_legible, es_firma_valida
from app.soporte_transversal.tiempo import hoy_club
from app.servicios_negocio.dtos.membresia_pago_schemas import (
    TipoMembresiaCreateDTO, TipoMembresiaUpdateDTO, MembresiaCreateDTO, PagoCreateDTO, PagoValidarDTO,
    ComprobantePagoCreateDTO,
    PagoListItemDTO, PagoResponseDTO, RegularizacionDeudaDTO, CorreccionPagoDTO,
    CambioPlanMembresiaDTO, InscripcionRepresentadoPagoDTO,
)
from app.servicios_negocio.dtos.cobertura_bonificada_schemas import (
    CoberturaBonificadaCreateDTO, CoberturaBonificadaResponseDTO,
    CoberturaBonificadaListItemDTO,
)
from app.servicios_negocio.dtos.beneficio_schemas import AsignacionDescuentoResponseDTO
from app.servicios_negocio.dtos.descuento_schemas import DescuentoResponseDTO


def _sumar_meses(fecha: date, meses: int) -> date:
    """Suma `meses` meses calendario a `fecha`, recortando al último día del
    mes destino cuando el día de origen no existe ahí (31 ene + 1 mes = 28/29
    feb, nunca 3 de marzo). Espejo en Python de `addMonthsIso`
    (`frontend/src/app/student/payments/payments-utils.ts`): las dos deben
    coincidir porque el frontend usa la misma cuenta para PREVISUALIZAR el
    período antes de confirmar, aunque quien decide la fecha real, desde este
    fix, es el backend."""
    mes_total = fecha.month - 1 + meses
    anio = fecha.year + mes_total // 12
    mes = mes_total % 12 + 1
    ultimo_dia_mes_destino = calendar.monthrange(anio, mes)[1]
    return date(anio, mes, min(fecha.day, ultimo_dia_mes_destino))


def _fin_de_cobertura(inicio: date, periodos: int, periodicidad: PeriodicidadTarifa) -> date:
    """Fin (exclusivo, igual que los meses) de la cobertura que compran
    `periodos` períodos de la tarifa desde `inicio`: meses calendario para
    MENSUAL, 7 días por período para SEMANAL, 1 día para DIARIA (la cobertura
    de un día suelto es SOLO el día pagado)."""
    if periodicidad == PeriodicidadTarifa.SEMANAL:
        return inicio + timedelta(days=7 * periodos)
    if periodicidad == PeriodicidadTarifa.DIARIA:
        return inicio + timedelta(days=periodos)
    return _sumar_meses(inicio, periodos)


def _meses_del_periodo(inicio: date, fin: date) -> int:
    """Meses del período `inicio..fin` (con `inicio < fin`): la menor cantidad
    entera de meses `m >= 1` tal que `_sumar_meses(inicio, m) >= fin`. Tanto
    `2026-04-01..2026-07-31` como `2026-04-01..2026-08-01` son 4 meses; un mes
    parcial se cuenta entero (redondeo hacia arriba)."""
    meses = (fin.year - inicio.year) * 12 + (fin.month - inicio.month)
    if _sumar_meses(inicio, meses) < fin:
        meses += 1
    return meses


def _meses_enteros_desde(fin: date, hoy: date) -> int:
    """Meses calendario COMPLETOS transcurridos entre `fin` y `hoy`.

    Paridad con el SQL verificado por el club (issue #284):

        date_part('year', age(CURRENT_DATE, ultimo_fin)) * 12
        + date_part('month', age(CURRENT_DATE, ultimo_fin))

    con `hoy_club()` en lugar de `CURRENT_DATE`. La resta por año/mes cuenta
    meses calendario completos, así que si el día de `hoy` aún no alcanzó el día
    de `fin` en el mes corriente, ese mes no se cuenta (se resta uno).
    """
    meses = (hoy.year - fin.year) * 12 + (hoy.month - fin.month)
    if hoy.day < fin.day:
        meses -= 1
    return meses


def _maximo_fecha_opcional(*fechas: date | None) -> date | None:
    """`max()` que tolera `None` (fecha ausente) sin romper -- `None` si
    NINGUNA fecha está presente, la mayor de las que sí lo están en caso
    contrario. Único lugar donde vive "combinar dos anclas de cobertura
    opcionales" (issue #326): `_fecha_fin_maxima_combinada` (una membresía)
    y `PagoServicio.obtener_deuda_bulk` (N membresías, con mapas
    pre-cargados) lo comparten en vez de repetir el `[f for f in (...) if f
    is not None]` cada uno por su lado."""
    candidatos = [fecha for fecha in fechas if fecha is not None]
    return max(candidatos) if candidatos else None


# --- Regla Familiar E04-RF002 -----------------------------------------------
# Si una familia (mismos representados bajo el mismo representante_id) ya
# tiene 3 membresías ACTIVAS en el mismo periodo, el 4to miembro recibe
# gratuidad automática: `es_gratuidad_familiar` pasa a `True`. Desde el
# slice 4c-b (issue #400) esto YA NO zerea `monto_aplicado` -- la tarifa
# real se conserva y la bandera es la única señal autorizada de "no paga"
# (ver `registrar_pago`).
FAMILIA_UMBRAL_GRATUIDAD = 3


# --- Voucher de transferencia (adjuntado por el cliente) ---------------------
# no incluye image/webp, image/gif, image/bmp: el cliente sube evidencia de
# transferencia bancaria y se mantiene el catálogo deliberadamente acotado.
TIPOS_MIME_PERMITIDOS_VOUCHER = {"image/jpeg", "image/png", "application/pdf"}
TAMANO_MAXIMO_VOUCHER_BYTES = 5 * 1024 * 1024  # 5 MB


# --- Invariantes respaldados por la base (issue #8) --------------------------
# Los chequeos de servicio siguen siendo el camino primario de error (UX);
# los índices únicos parciales de `c3d9f2b7a1e5` son la red de seguridad ante
# la carrera que el chequeo no puede ver. Cuando la red atrapa, la API debe
# responder EL MISMO error de dominio que el chequeo -- por eso los mensajes
# viven en constantes compartidas entre ambos caminos.
MENSAJE_PAGO_PENDIENTE_DUPLICADO = (
    "Esta membresía ya tiene un pago por validar. "
    "Espera a que sea validado antes de registrar uno nuevo."
)
MENSAJE_MEMBRESIA_PENDIENTE_DE_PAGO = "Ya tiene una membresía pendiente de pago."
MENSAJE_MEMBRESIA_INACTIVA_EXISTENTE = (
    "Esta persona ya tiene una membresía inactiva. Registra el pago en esa "
    "membresía para activarla."
)

MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA = (
    "La persona ya tiene una membresía activa o suspendida. "
    "Cancela, deja vencer, o reactiva la actual antes de crear una nueva."
)

# --- Issue #400 (criterio 1): cambio de plan ---------------------------------
MENSAJE_CAMBIO_PLAN_MISMO_TIPO = (
    "La membresía ya tiene asignado ese tipo de membresía."
)

# --- Issue #400 (slice 5a): suspensión y reactivación ------------------------
# Redactados en minúscula a propósito (test_vocabulario_en_mensajes_de_
# usuario.py, `_miembros_de_enums`): el candado de vocabulario detecta el
# NOMBRE del enum tal cual se escribe en `enums.py` (mayúsculas), así que
# "activa"/"suspendida" en prosa castellana no lo dispara, pero "ACTIVA"/
# "SUSPENDIDA" sí -- por más que sea prosa legítima para un socio.
MENSAJE_SUSPENSION_ORIGEN_INVALIDO = (
    "Solo una membresía activa puede suspenderse."
)
MENSAJE_REACTIVACION_ORIGEN_INVALIDO = (
    "Solo una membresía suspendida puede reactivarse."
)
MENSAJE_MEMBRESIA_SUSPENDIDA = (
    "Esta membresía está suspendida; reactívala antes de registrar un pago "
    "o aplicar un beneficio."
)
MENSAJE_PERSONA_RETIRO = "Esta persona fue retirada y no puede recibir operaciones financieras."
MENSAJE_FECHA_EFECTIVA_FUTURA = (
    "La fecha efectiva no puede ser una fecha futura."
)
MENSAJE_FECHA_EFECTIVA_RETROCEDE = (
    "La fecha efectiva no puede ser anterior a la fecha efectiva de la "
    "última transición registrada de esta membresía."
)

# --- Issue #1402: pago presencial de primera inscripción --------------------
# El admin anota en el club el PRIMER pago de inscripción de una membresía.
# El endpoint es admin-only; estos mensajes cubren las dos guardias que la
# ruta no puede resolver sola (necesitan leer el payload y la base).
MENSAJE_PAGO_PRESENCIAL_PROPIO = (
    "El pago presencial de primera inscripción se registra para el socio "
    "presente en el club; para un pago propio usa el flujo regular, que "
    "queda por validar."
)
MENSAJE_PAGO_PRESENCIAL_NO_PRIMERA_INSCRIPCION = (
    "La aprobación inmediata presencial solo aplica a la primera inscripción: "
    "una membresía inactiva sin ningún pago aprobado. Registra renovaciones "
    "por el flujo regular y apruébalas desde la cola de validación."
)

# --- Issue #400 (slice 4d): cobertura bonificada -----------------------------
MENSAJE_COBERTURA_YA_APLICADA = (
    "El período indicado ya tiene cobertura (un pago aprobado, o un "
    "beneficio bonificado ya otorgado)."
)
MENSAJE_BENEFICIO_NO_ES_TOTAL = (
    "El beneficio vigente no cubre el 100% de este período; "
    "regístralo como un pago normal."
)
MENSAJE_MEMBRESIA_YA_GRATUITA = (
    "Esta membresía ya tiene cobertura gratuita por regla familiar; "
    "aplicar un beneficio bonificado no corresponde."
)
# Issue #1369: una activación del beneficio bonificado otorga EXACTAMENTE un
# mes -- nunca una cantidad elegida por el cliente. Cubrir el mes siguiente
# exige activar de nuevo (la segunda activación ancla donde terminó la
# anterior, sin pisarla: `_hay_cobertura_en_rango`). Un descuento de monto
# FIJO califica como "100%" solo si iguala exactamente la tarifa de ESE mes.
MESES_POR_ACTIVACION_BENEFICIO = 1
# QA owner R2 (S12): un pago con beneficio vigente se paga mes a mes.
MENSAJE_BENEFICIO_SOLO_MES_A_MES = (
    "Con beneficio activo solo puedes pagar un mes a la vez."
)

# Tarifas semanales/diarias: un período por pago y sin deuda que regularizar.
MENSAJE_PERIODICIDAD_UN_PERIODO = (
    "Las tarifas semanales y diarias se pagan de a un período por vez."
)
MENSAJE_PERIODICIDAD_SIN_DEUDA = (
    "Las tarifas semanales y diarias no acumulan deuda; no hay nada que regularizar."
)

logger = logging.getLogger("cataclub.servicios.pagos")


# --- Issue #11/#398: descuento congelado, previo a volcarse en columnas de
# Pago. `autorizado_por_persona_id` (issue #398/3c) es SIEMPRE el admin que
# concedió la asignación (`AsignacionDescuento.asignado_por_persona_id`),
# nunca quien registró este pago -- ver docstring de
# `_congelar_beneficio_activo` y de `Pago.descuento_autorizado_por_persona_id`.
# `asignacion_id` (issue #400/4d) es el id de la propia `AsignacionDescuento`
# -- lo necesita `aplicar_beneficio_bonificado` para el vínculo permanente
# `CoberturaBonificada.asignacion_descuento_id`; `registrar_pago` lo ignora.
@dataclass(frozen=True)
class _DescuentoCongelado:
    descuento_id: int
    asignacion_id: int
    valor_aplicado: Decimal
    porcentaje_aplicado: Decimal | None
    autorizado_por_persona_id: int


@dataclass(frozen=True)
class _CotizacionRegularizacion:
    meses: int
    monto_base: Decimal
    descuento: _DescuentoCongelado | None
    monto_esperado: Decimal
    # Beneficio vigente del período aunque el admin elija el valor normal
    # (`descuento` queda en `None` en ese caso).
    beneficio_disponible: _DescuentoCongelado | None = None

    @property
    def descuento_aplicado(self) -> Decimal:
        return self.descuento.valor_aplicado if self.descuento is not None else Decimal("0.00")


class TarifaEnUso(RecursoEnUso):
    """Se intentó eliminar una tarifa que ya se usó (-> 409)."""


class MembresiaServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = MembresiaRepositorio(db)
        self.repo_tipo = TipoMembresiaRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)

    def _exigir_tarifa_libre(self, nombre: str, excluir_id: int | None = None) -> None:
        """QA3 ADM-11: el nombre de una tarifa es único (sin distinguir
        mayúsculas ni espacios; las tildes sí distinguen)."""
        otros = [t.categoria for t in self.repo_tipo.listar() if t.id != excluir_id]
        if existe_nombre(nombre, otros):
            raise NombreDuplicado(f"Ya existe una tarifa con el nombre '{nombre}'.")

    def crear_tipo_membresia(self, datos: TipoMembresiaCreateDTO) -> TipoMembresia:
        categoria = normalizar_nombre(datos.categoria)
        self._exigir_tarifa_libre(categoria)
        resultado = self.repo_tipo.crear(
            TipoMembresia(**{**datos.model_dump(), "categoria": categoria})
        )
        self.db.commit()
        # `expire_on_commit` (default True) expira el objeto tras el commit
        # de arriba; antes lo refrescaba el propio repositorio (issue #831).
        if inspeccionar_orm(resultado).expired:
            self.db.refresh(resultado)
        self._marcar_en_uso([resultado])
        return resultado

    def _marcar_en_uso(self, tipos: list[TipoMembresia]) -> list[TipoMembresia]:
        """Anota `en_uso` (atributo transitorio, no columna) para el DTO. Una
        sola consulta para todo el lote, sin N+1."""
        usados = self.repo_tipo.ids_en_uso([t.id for t in tipos])
        for tipo in tipos:
            tipo.en_uso = tipo.id in usados
        return tipos

    def listar_tipos_membresia(self, solo_activas: bool = False) -> list[TipoMembresia]:
        return self._marcar_en_uso(self.repo_tipo.listar(solo_activas=solo_activas))

    def eliminar_tipo_membresia(self, tipo_id: int) -> None:
        """Borrado duro, solo de una tarifa que nunca se usó (ni en una
        membresía ni en la auditoría de un cambio de plan). Si se usó, el
        camino es ocultarla (`activo=False`)."""
        tipo = self.repo_tipo.obtener_por_id(tipo_id)
        if not tipo:
            raise EntidadNoEncontrada(f"Tipo de membresía con id {tipo_id} no encontrado")
        mensaje_en_uso = (
            f"No se puede eliminar la tarifa '{tipo.categoria}' porque ya se usó "
            "en membresías. Puedes ocultarla para que deje de ofrecerse."
        )
        if self.repo_tipo.ids_en_uso([tipo.id]):
            raise TarifaEnUso(mensaje_en_uso)
        try:
            self.repo_tipo.eliminar(tipo)
            self.db.commit()
        except IntegrityError as error:
            # Carrera: una membresía/cambio de plan se confirmó entre el
            # pre-chequeo y el DELETE; la FK protege la historia, acá solo se
            # traduce al mismo 409 de la vía rápida.
            self.db.rollback()
            raise TarifaEnUso(mensaje_en_uso) from error

    def actualizar_tipo_membresia(
        self, tipo_id: int, datos: TipoMembresiaUpdateDTO,
    ) -> TipoMembresia:
        """Actualización parcial del catálogo de tarifas (issue #394).

        NO toca ninguna membresía ni ningún pago, y eso no es un olvido: es
        la regla no negociable de #400. `membresia.monto_aplicado` es una
        COPIA del precio al momento de asignar el plan, no una referencia
        viva, y cada pago congela sus propios valores. Por eso subir la cuota
        del catálogo alcanza solo a los pagos FUTUROS, y el historial nunca
        se recalcula. Los candados de `tests/test_tarifas_administracion.py`
        fijan esa propiedad, porque es la que se rompería en silencio: sin
        error y sin excepción, solo plata vieja que cambia de valor.
        """
        tipo = self.repo_tipo.obtener_por_id(tipo_id)
        if not tipo:
            raise EntidadNoEncontrada(f"Tipo de membresía con id {tipo_id} no encontrado")

        cambios = datos.model_dump(exclude_unset=True)
        nueva_periodicidad = cambios.get("periodicidad")
        if (
            nueva_periodicidad is not None
            and PeriodicidadTarifa(nueva_periodicidad) != PeriodicidadTarifa(tipo.periodicidad)
            and self.repo_tipo.ids_en_uso([tipo.id])
        ):
            # La cobertura y la deuda de las membresías existentes se calculan
            # con la periodicidad de su tarifa: cambiarla reinterpretaría el
            # historial en silencio.
            raise TarifaEnUso(
                f"No se puede cambiar la periodicidad de la tarifa '{tipo.categoria}' "
                "porque ya se usó en membresías. Crea una tarifa nueva con la "
                "periodicidad que necesitas."
            )
        if cambios.get("categoria"):
            cambios["categoria"] = normalizar_nombre(cambios["categoria"])
            self._exigir_tarifa_libre(cambios["categoria"], excluir_id=tipo.id)
        for campo, valor in cambios.items():
            setattr(tipo, campo, valor)

        resultado = self.repo_tipo.guardar_cambios(tipo)
        self.db.commit()
        if inspeccionar_orm(resultado).expired:
            self.db.refresh(resultado)
        self._marcar_en_uso([resultado])
        return resultado

    def crear_membresia(self, datos: MembresiaCreateDTO) -> Membresia:
        membresia = self._crear_membresia_sin_commit(datos)
        self.db.commit()
        if inspeccionar_orm(membresia).expired:
            self.db.refresh(membresia)
        return membresia

    def _crear_membresia_sin_commit(self, datos: MembresiaCreateDTO) -> Membresia:
        if not self.repo_persona.obtener_por_id(datos.persona_id):
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        tipo = self.repo_tipo.obtener_por_id(datos.tipo_membresia_id)
        if not tipo:
            raise EntidadNoEncontrada(f"Tipo de membresía con id {datos.tipo_membresia_id} no encontrado")
        if not tipo.activo:
            raise OperacionInvalida(
                f"La tarifa '{tipo.categoria}' está oculta y no admite nuevas "
                "membresías. Muéstrala de nuevo o elige otra tarifa."
            )
        existentes = self.repo.listar_por_persona(datos.persona_id)
        # Issue #400 (slice 5a): SUSPENDIDA cuenta como operativa, igual que
        # ACTIVA -- ver el docstring del índice `uq_membresia_activa_por_
        # persona` en `modelos.py`. Sin este chequeo, alguien podía
        # suspenderse y de inmediato inscribir una membresía nueva para el
        # mismo plan; el índice ensanchado es la red de seguridad, este
        # chequeo Python es el camino primario de error (UX).
        if any(
            m.estado in (EstadoMembresia.ACTIVA, EstadoMembresia.SUSPENDIDA)
            for m in existentes
        ):
            raise OperacionInvalida(MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA)
        # QA3 ADM-08: una INACTIVA con pago pendiente ya es "la" membresía en
        # trámite; crear otra deja pagos pendientes imposibles de aprobar.
        for m in existentes:
            if (
                m.estado == EstadoMembresia.INACTIVA
                and PagoRepositorio(self.db).existe_pendiente_para_membresia(m.id)
            ):
                raise MembresiaPendienteDePago(MENSAJE_MEMBRESIA_PENDIENTE_DE_PAGO, m.id)
        # QA4 ADMA-05/FAM-01: una INACTIVA sin pago pendiente tampoco admite
        # otra; la salida es registrar el pago en la existente, no duplicarla.
        inactiva = next(
            (m for m in existentes if m.estado == EstadoMembresia.INACTIVA), None
        )
        if inactiva is not None:
            raise MembresiaPendienteDePago(MENSAJE_MEMBRESIA_INACTIVA_EXISTENTE, inactiva.id)
        # Issue #1132: matricularse ya NO otorga (ni exige) ningún rol. "Ser
        # jugador" se deriva exclusivamente de la membresía ACTIVA (ver
        # `app.dominio.jugador.es_jugador`), nunca del rol -- un
        # representante que paga una membresía para sí mismo conserva su
        # único rol técnico REPRESENTANTE (issue #762 sigue intacto).
        # Estado y fecha_activacion NO vienen del payload (B-12): una membresía
        # nace INACTIVA y se ACTIVA al aprobarse su primer pago. La
        # fecha_activacion intermedia es necesaria porque la columna es NOT
        # NULL en el esquema existente; el valor real lo sobreescribe
        # `validar_pago` al aprobar.
        # La tarifa la resuelve el BACKEND desde el catálogo vigente, no el
        # cliente (#400). Se copia, no se referencia: a partir de acá la
        # membresía tiene su propio monto y un cambio posterior del catálogo
        # no la toca. Las dos mitades de esa regla las fija
        # `tests/test_tarifa_resuelta_server_side.py`.
        from datetime import datetime, timezone
        membresia = Membresia(
            estado=EstadoMembresia.INACTIVA,
            monto_aplicado=tipo.precio,
            fecha_activacion=datetime.now(timezone.utc),
            persona_id=datos.persona_id,
            tipo_membresia_id=datos.tipo_membresia_id,
        )
        membresia = self.repo.crear(membresia)
        self.db.flush()
        return membresia

    def crear_membresia_propia(self, persona_id: int, tipo_membresia_id: int) -> Membresia:
        """Autoservicio (issue #1132): un representante puede matricular una
        membresía para su MISMA Persona y pagarla -- la única diferencia con
        `crear_membresia` es de dónde sale `persona_id`: siempre el de la
        propia sesión (lo deriva el router del token), nunca un valor que el
        cliente elija. Reusa `crear_membresia` entera -- misma regla de
        duplicado ACTIVA/SUSPENDIDA, mismo nacimiento INACTIVA, y ningún rol
        se asigna ni se exige."""
        return self.crear_membresia(
            MembresiaCreateDTO(persona_id=persona_id, tipo_membresia_id=tipo_membresia_id)
        )

    def cambiar_plan(
        self, membresia_id: int, datos: CambioPlanMembresiaDTO, actor_persona_id: int,
    ) -> Membresia:
        """Cambia el `TipoMembresia` de una membresía YA existente (issue
        #400, criterio 1), admin-only.

        Decisión de producto ya tomada (issue #400): PROSPECTIVO. La
        cobertura ya pagada -- `fecha_inicio`/`fecha_fin` de `Pago`s
        `APROBADO` y de `CoberturaBonificada` ya existentes -- NO se toca ni
        se recalcula acá, mismo criterio que ya rige un cambio de tarifa de
        CATÁLOGO (`actualizar_tipo_membresia`, issue #394/2a) aplicado ahora
        a nivel de una membresía individual. Este método no lee ni escribe
        ningún `Pago`.

        `monto_aplicado` SÍ se resincroniza con la tarifa del plan nuevo
        (copia, no referencia -- mismo criterio que `crear_membresia`/
        `reactivar_membresia`): es la columna que `registrar_pago` lee para
        cobrar el PRÓXIMO pago (`precio_mensual = membresia.monto_aplicado`).
        Sin este resync, "la tarifa nueva rige desde el próximo pago" sería
        falso -- el próximo pago seguiría cobrando la tarifa del plan viejo.

        Mismo lock que `suspender_membresia`/`reactivar_membresia`/
        `corregir_pago` (`obtener_por_id_con_bloqueo`, `SELECT ... FOR
        UPDATE`): dos cambios de plan concurrentes sobre la MISMA membresía
        deben serializarse, no perder ninguna de las dos filas de auditoría
        ni dejar `monto_aplicado` en un valor que no corresponda a
        `tipo_membresia_id` final.

        Sin restricción de `estado` de origen a propósito: el issue no pide
        ninguna, y esta operación no depende del estado (no otorga ni quita
        cobertura, no genera ni salda deuda) -- a diferencia de suspender/
        reactivar, que sí son transiciones de estado con un origen válido
        estricto. Si el club necesita restringir esto más adelante (ej. no
        cambiar de plan con un pago PENDIENTE_VALIDACION en curso), es una
        decisión de producto nueva, fuera de este alcance.
        """
        membresia = self.repo.obtener_por_id_con_bloqueo(membresia_id)
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")

        tipo_nuevo = self.repo_tipo.obtener_por_id(datos.nuevo_tipo_membresia_id)
        if not tipo_nuevo:
            raise EntidadNoEncontrada(
                f"Tipo de membresía con id {datos.nuevo_tipo_membresia_id} no encontrado"
            )

        if membresia.tipo_membresia_id == datos.nuevo_tipo_membresia_id:
            raise OperacionInvalida(MENSAJE_CAMBIO_PLAN_MISMO_TIPO)
        if not tipo_nuevo.activo:
            raise OperacionInvalida(
                f"La tarifa '{tipo_nuevo.categoria}' está oculta y no admite nuevas "
                "membresías. Muéstrala de nuevo o elige otra tarifa."
            )

        tipo_anterior_id = membresia.tipo_membresia_id
        membresia.tipo_membresia_id = tipo_nuevo.id
        membresia.monto_aplicado = tipo_nuevo.precio
        self.db.add(
            HistorialCambioPlanMembresia(
                membresia_id=membresia.id,
                tipo_membresia_id_anterior=tipo_anterior_id,
                tipo_membresia_id_nuevo=tipo_nuevo.id,
                actor_persona_id=actor_persona_id,
            )
        )
        resultado = self.repo.guardar_cambios(membresia)
        self.db.commit()
        if inspeccionar_orm(resultado).expired:
            self.db.refresh(resultado)
        return resultado

    def obtener_membresia(
        self,
        membresia_id: int,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> Membresia:
        """Obtiene una membresía por ID, aplicando autorización
        owner/representative/admin (mismo criterio que listar_membresias_por_persona).
        Sin parámetros de autorización (todos None) se comporta como antes:
        solo existencia; útil para contextos internos donde el caller ya validó.

        Autorización primero, existencia después (issue #457, mismo criterio
        que `PagoServicio.registrar_pago`): sin esto, un solicitante sin
        ningún vínculo con la membresía podía distinguir "no existe" (404)
        de "existe pero no es mía" (403) probando ids consecutivos. Solo un
        ADMINISTRADOR conserva esa distinción -- para todos los demás, ambos
        casos caen en el mismo 403.
        """
        membresia = self.repo.obtener_por_id(membresia_id)

        # Sin contexto de autorización, comportamiento anterior preservado
        # para usos internos: solo existencia.
        if persona_id_solicitante is None and not roles_solicitante:
            if not membresia:
                raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")
            return membresia

        roles_solicitante = roles_solicitante or []
        es_admin = "ADMINISTRADOR" in roles_solicitante
        autorizado = es_admin or (
            membresia is not None
            and PoliticaAccesoPersona(self.db).puede_acceder(
                persona_id_objetivo=membresia.persona_id,
                persona_id_solicitante=persona_id_solicitante,
                roles_solicitante=roles_solicitante,
            )
        )
        if not autorizado:
            raise PermisosInsuficientes(
                "Solo la propia persona, su representante, o un administrador "
                "pueden ver esta membresía"
            )
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")
        return membresia

    def contar_membresias_activas(self) -> int:
        return self.repo.contar_activas()

    def listar_membresias_por_persona(
        self,
        persona_id_objetivo: int,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> list[Membresia]:
        """Membresías de una persona para lectura por el propio alumno, su
        representante, o un administrador. Mismo criterio de autorización que
        `PagoServicio.listar_pagos_de_persona` (ver `PoliticaAccesoPersona`)."""
        roles_solicitante = roles_solicitante or []
        if not PoliticaAccesoPersona(self.db).puede_acceder(
            persona_id_objetivo=persona_id_objetivo,
            persona_id_solicitante=persona_id_solicitante,
            roles_solicitante=roles_solicitante,
        ):
            raise PermisosInsuficientes(
                "Solo la propia persona, su representante, o un administrador "
                "pueden ver estas membresías"
            )

        return self.repo.listar_por_persona(persona_id_objetivo)

    def listar_membresias(
        self, skip: int = 0, limit: int = 200
    ) -> tuple[list[Membresia], int]:
        """Listado paginado de todas las membresías. Devuelve (items, total)
        para que el frontend/dashboard pueda conocer el estado de todas sin
        N+1 consultas (ver issue #4)."""
        items = self.repo.listar(skip=skip, limit=limit)
        # El total se obtiene con un count simple; MembresiaRepositorio no
        # expone un método count(), así que lo hacemos inline aquí.
        total = self.db.query(Membresia).count()
        return items, total


class PagoServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = PagoRepositorio(db)
        self.repo_comprobante = ComprobantePagoRepositorio(db)
        self.repo_membresia = MembresiaRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        self.repo_notificacion = NotificacionRepositorio(db)
        self.repo_descuento = DescuentoRepositorio(db)
        self.repo_asignacion = AsignacionDescuentoRepositorio(db)
        self.repo_cobertura_bonificada = CoberturaBonificadaRepositorio(db)
        self.repo_rol = RolRepositorio(db)
        # Issue #400 (slice 5a): `repo_tipo` resincroniza la tarifa al
        # reactivar (`TipoMembresia.precio` vigente, no el congelado);
        # `repo_historial_estado` lee la última reactivación para el reloj
        # de deuda (ver `calcular_meses_adeudados`).
        self.repo_tipo = TipoMembresiaRepositorio(db)
        self.repo_historial_estado = HistorialEstadoMembresiaRepositorio(db)

    def _exigir_membresia_financieramente_operativa(self, membresia: Membresia) -> None:
        persona = self.repo_persona.obtener_por_id(membresia.persona_id)
        if persona is None or not persona.activo:
            raise OperacionInvalida(MENSAJE_PERSONA_RETIRO)
        if membresia.estado == EstadoMembresia.SUSPENDIDA:
            raise OperacionInvalida(MENSAJE_MEMBRESIA_SUSPENDIDA)

    def registrar_pago(
        self,
        datos: PagoCreateDTO,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> Pago:
        resultado = self._registrar_pago_sin_commit(
            datos, persona_id_solicitante, roles_solicitante,
        )
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            if "uq_pago_pendiente_por_membresia" in str(error.orig):
                raise OperacionInvalida(MENSAJE_PAGO_PENDIENTE_DUPLICADO) from error
            raise
        if inspeccionar_orm(resultado).expired:
            self.db.refresh(resultado)
        self._notificar_pago_registrado(resultado)
        return resultado

    def _notificar_pago_registrado(self, pago: Pago) -> None:
        try:
            persona = self.repo_persona.obtener_por_id(pago.persona_id)
            if persona is not None and persona.representante_id:
                self._crear_notificacion_pago(
                    pago, TipoNotificacion.PAGO_REGISTRADO,
                    f"Tu pago de {formatear_monto_usd(pago.monto)} fue registrado y está por validar.",
                )
        except Exception:
            self.db.rollback()
            logger.exception("No se pudo notificar el pago registrado %s", pago.id)

    def inscribir_representado_con_pago(
        self, datos: InscripcionRepresentadoPagoDTO, representante_id: int,
    ) -> Pago:
        """Enroll and record a dependent's first payment in one transaction.

        Lock the dependent row to serialize two concurrent enrolment attempts.
        A matching pending payment is the result of a retried request.
        """
        try:
            persona = self.db.query(Persona).filter(
                Persona.id == datos.persona_id,
            ).with_for_update().one_or_none()
            if persona is None or persona.representante_id != representante_id:
                raise PermisosInsuficientes("Solo el representante puede inscribir a su representado")
            if _calcular_edad(persona.fecha_nacimiento) >= 18:
                raise OperacionInvalida("Esta inscripción directa requiere un menor de edad")

            membresias = self.repo_membresia.listar_por_persona(datos.persona_id)
            operativas = [m for m in membresias if m.estado in (
                EstadoMembresia.ACTIVA, EstadoMembresia.SUSPENDIDA,
            )]
            inactivas = [m for m in membresias if m.estado == EstadoMembresia.INACTIVA]
            if operativas:
                raise OperacionInvalida(MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA)
            membresia = next(
                (m for m in inactivas if m.tipo_membresia_id == datos.tipo_membresia_id), None,
            )
            if membresia is None:
                if inactivas:
                    raise OperacionInvalida("Ya existe una membresía inactiva con otro plan")
                membresia = MembresiaServicio(self.db)._crear_membresia_sin_commit(
                    MembresiaCreateDTO(
                        persona_id=datos.persona_id,
                        tipo_membresia_id=datos.tipo_membresia_id,
                    )
                )
            pendiente = self.db.query(Pago).filter(
                Pago.membresia_id == membresia.id,
                Pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION,
            ).one_or_none()
            if pendiente is not None:
                if pendiente.tipo_pago != datos.tipo_pago or pendiente.meses_comprados != datos.meses:
                    raise OperacionInvalida(MENSAJE_PAGO_PENDIENTE_DUPLICADO)
                self.db.commit()
                return pendiente
            pago = self._registrar_pago_sin_commit(
                PagoCreateDTO(
                    persona_id=datos.persona_id, membresia_id=membresia.id,
                    tipo_pago=datos.tipo_pago, meses=datos.meses,
                ),
                persona_id_solicitante=representante_id,
                roles_solicitante=["REPRESENTANTE"],
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        if inspeccionar_orm(pago).expired:
            self.db.refresh(pago)
        self._notificar_pago_registrado(pago)
        return pago

    @staticmethod
    def _rechazar_regularizacion_como_pago(datos: PagoCreateDTO) -> None:
        """REGULARIZACION solo nace en `regularizar_deuda` (monto calculado
        del período y el descuento vigente); ningún rol la crea por acá."""
        if datos.tipo_pago == TipoPago.REGULARIZACION:
            raise OperacionInvalida(
                "La regularización no se registra como pago: usa la "
                "acción \"Regularizar deuda\" de la membresía."
            )

    @staticmethod
    def _validar_meses_con_beneficio(descuento_congelado, meses: int) -> None:
        """Con un beneficio vigente solo se paga un mes a la vez (QA owner R2, S12)."""
        if descuento_congelado is not None and meses > 1:
            raise OperacionInvalida(MENSAJE_BENEFICIO_SOLO_MES_A_MES)

    def _registrar_pago_sin_commit(
        self,
        datos: PagoCreateDTO,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> Pago:
        """
        Autorización primero, existencia después (para no filtrar existencia
        de recursos ajenos a quien no tiene ningún vínculo con ellos):
        dueño, su representante, o un ADMINISTRADOR pueden registrar el pago.

        E04-RF003 exige que el "Alumno O Representante" puedan subir el
        comprobante -- el chequeo original solo contemplaba al dueño, lo que
        en la práctica le impedía a un representante pagar por su
        representado. Se corrige aquí.

        Para resolver "es representante" hace falta leer la Persona
        objetivo, pero SOLO se hace esa consulta cuando ni dueño ni admin ya
        autorizan de entrada -- así un solicitante sin ningún vínculo real
        sigue sin poder distinguir "persona inexistente" de "persona sin
        relación conmigo" (ambos dan 403 igual).
        """
        roles_solicitante = roles_solicitante or []
        es_duenio = persona_id_solicitante is not None and persona_id_solicitante == datos.persona_id
        es_admin = "ADMINISTRADOR" in roles_solicitante

        if not PoliticaAccesoPersona(self.db).puede_acceder(
            persona_id_objetivo=datos.persona_id,
            persona_id_solicitante=persona_id_solicitante,
            roles_solicitante=roles_solicitante,
        ):
            raise PermisosInsuficientes(
                "Solo la propia persona, su representante, o un administrador "
                "pueden registrar este pago"
            )

        self._rechazar_regularizacion_como_pago(datos)

        # EFECTIVO no tiene guarda propia (issue #565): el administrador
        # autorizado puede registrarlo desde Members a nombre de un tercero, y
        # cualquier otro solicitante ya quedó filtrado por el guard de arriba
        # -- dueño y representante son justamente los que sí pueden declarar la
        # entrega. Hasta el issue #823 acá sobrevivía una rama que exigía `not`
        # sobre los tres flags a la vez: la negación exacta de lo que el guard
        # anterior acababa de garantizar, inalcanzable por construcción y sin
        # una sola línea de cobertura. La regla real de efectivo es la que
        # fija `tests/test_efectivo_solo_por_socio.py`.

        # Recién aquí (ya autorizado) se resuelve existencia real y, si
        # corresponde, el chequeo de solo-lectura financiera para menores
        # (E01-RF006/RF007). No aplica si actúa el representante o un admin.
        if es_duenio and not es_admin:
            persona_objetivo = self.repo_persona.obtener_por_id(datos.persona_id)
            if not persona_objetivo:
                raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
            edad = _calcular_edad(persona_objetivo.fecha_nacimiento)
            if edad < 18:
                raise PermisosInsuficientes(
                    "Los jugadores menores de edad tienen acceso de solo lectura "
                    "al módulo financiero; un representante o el Administrador "
                    "deben registrar este pago"
                )

        # `FOR UPDATE` (issue #400/5b, hallazgo del revisor): antes de este
        # slice un `Pago` APROBADO era inmutable, así que este ancla
        # (`_fecha_fin_maxima_combinada`, leída más abajo) nunca podía
        # quedar obsoleta a mitad de vuelo. `PagoServicio.corregir_pago`
        # introduce esa ventana -- puede mutar `fecha_fin` de un pago YA
        # aprobado mientras este método todavía está anclando un pago NUEVO
        # sobre el valor viejo. El lock serializa: quien pierde la carrera
        # relee el estado ya corregido/registrado por el otro. Mismo
        # mecanismo (`obtener_por_id_con_bloqueo`) que `suspender_membresia`/
        # `reactivar_membresia` ya usan sobre `Membresia`.
        membresia = self.repo_membresia.obtener_por_id_con_bloqueo(datos.membresia_id)
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {datos.membresia_id} no encontrada")

        # La membresía debe pertenecer a la MISMA persona del pago (auditoría,
        # crítico 1): sin este chequeo, cualquier usuario podía registrar un
        # pago propio apuntando a la membresía de un tercero y, al aprobarse,
        # activar la membresía ajena. El pago cruzado es inconsistente para
        # cualquier rol, así que aplica también a un ADMINISTRADOR. Mismo
        # criterio de respuesta que el resto de recursos ajenos existentes
        # (ver test_seguridad_acceso_recursos.py): 403, no 404.
        if membresia.persona_id != datos.persona_id:
            raise PermisosInsuficientes(
                "La membresía indicada no pertenece a la persona del pago"
            )

        # Issue #400 (slice 5a): "Suspender... bloquea nuevos pagos" -- una
        # membresía SUSPENDIDA no genera deuda mientras dura, así que
        # tampoco puede recibir un pago que compraría cobertura sobre un
        # período que la propia suspensión declaró "no se cobra". Debe
        # reactivarse primero (`PagoServicio.reactivar_membresia`).
        self._exigir_membresia_financieramente_operativa(membresia)

        if self.repo.existe_pendiente_para_membresia(datos.membresia_id):
            raise OperacionInvalida(MENSAJE_PAGO_PENDIENTE_DUPLICADO)

        # T5/S5 (L5): un pago iniciado por el socio no se acepta mientras su
        # cobertura vigente se pagó con descuento; el admin no queda bloqueado.
        self._exigir_cobertura_vigente_sin_descuento(datos.membresia_id, es_admin)

        # El usuario elige una cantidad ENTERA de meses, nunca un monto libre
        # (issue #400): `datos.meses` ya viene validado por el DTO (`gt=0`,
        # `le=12`), así que no hay ningún "múltiplo de la cuota" que
        # chequear acá -- esa regla existía SOLO porque el contrato viejo
        # recibía un monto y tenía que adivinar cuántos meses representaba.
        # El monto base se deriva multiplicando, en vez de adivinarse
        # dividiendo.
        precio_mensual = membresia.monto_aplicado
        meses = datos.meses
        periodicidad = membresia.tipo_membresia.periodicidad
        self._exigir_un_periodo_si_corresponde(periodicidad, meses)
        monto_base = precio_mensual * meses

        # Fix período de cobertura (PAG-5): antes, `fecha_inicio`/`fecha_fin`
        # llegaban del cliente y el servicio solo confiaba en que una fuera
        # anterior a la otra -- un pago de UN mes podía pedir DOCE de
        # cobertura y el 201 lo aceptaba (agujero reproducido en vivo, ver
        # docs/archive/fixes/06-periodo-de-cobertura.md). Ahora el backend deriva el
        # período: arranca donde termina la última cobertura ya otorgada (o
        # hoy si no hay ninguna, igual que antes leía el frontend) y avanza
        # tantos meses completos como el cliente pidió.
        #
        # Issue #400/4d (hallazgo del revisor, reproducido en vivo): el ancla
        # combina AMBAS tablas (`Pago` aprobado Y `cobertura_bonificada`) vía
        # `_fecha_fin_maxima_combinada` -- antes anclaba SOLO contra `Pago`,
        # así que un pago normal podía registrarse (y aprobarse) encima de un
        # período que un beneficio bonificado ya cubría. Al derivar SIEMPRE
        # el período (nunca lo elige el cliente), anclar sobre el máximo real
        # ya hace que el resultado no pueda solaparse por construcción -- no
        # hace falta un chequeo aparte de "rechazar" acá.
        ultima_fecha_fin = self._fecha_fin_maxima_combinada(datos.membresia_id)
        hoy = hoy_club()
        ancla = max(ultima_fecha_fin, hoy) if ultima_fecha_fin is not None else hoy
        fecha_inicio, fecha_fin = ancla, _fin_de_cobertura(ancla, meses, periodicidad)

        # Gratuidad familiar (E04-RF002, issue #400 slice 4c-b): el gate del
        # cobro es `membresia.es_gratuidad_familiar`, NUNCA
        # `precio_mensual == 0`. Antes de este slice ambas cosas coincidían
        # porque la gratuidad zereaba la tarifa; desde que
        # `_aplicar_regla_familiar_si_corresponde` deja la tarifa real
        # intacta, `precio_mensual == 0` deja de significar "gratuito" (puede
        # ser, simplemente, un plan cuyo catálogo cotiza $0) y la gratuidad
        # deja de significar "precio cero" (la membresía sigue teniendo una
        # tarifa real, solo que este socio no la paga). Un socio gratuito NO
        # pasa por `_congelar_beneficio_activo`: un descuento sobre un cobro
        # que ya es cero no aporta nada y esa función asume un monto base
        # potencialmente positivo para su chequeo de tope del 100%.
        #
        # Esta rama SOLO cubre el caso en que la membresía YA es gratuita al
        # momento de REGISTRAR el pago (una renovación). El pago que recién
        # cruza el umbral (el 4to miembro) todavía no tiene la bandera acá --
        # `es_gratuidad_familiar` se determina más tarde, al APROBAR (ver
        # `_aplicar_regla_familiar_si_corresponde`), que es quien completa
        # esta garantía zereando el `monto` de ESE MISMO pago cuando
        # corresponde. Ningún pago gratuito llega a APROBADO con un cobro
        # real: lo impide este gate (renovaciones) o el de ahí (el que
        # dispara la gratuidad).
        if membresia.es_gratuidad_familiar:
            descuento_congelado, monto_final = None, Decimal("0.00")
        else:
            # Issue #398/3c: resolver la asignación VIGENTE del PAGADOR
            # (`datos.persona_id`, no `persona_id_solicitante` -- un
            # representante o un admin pueden registrar el pago de otra
            # persona), congelarla y descontar el monto base. Las columnas
            # congeladas se asignan al MISMO `Pago` (issue #11 colapsado a
            # columnas: un pago lleva un solo descuento) para que el INSERT
            # sea una sola transacción: no puede quedar un pago descontado
            # sin su detalle.
            descuento_congelado, monto_final = self._congelar_beneficio_activo(
                datos.persona_id, monto_base,
            )
            self._validar_meses_con_beneficio(descuento_congelado, meses)

        # `Pago(**datos.model_dump(), ...)` ya no alcanza: `PagoCreateDTO`
        # perdió `monto` (la columna) y ganó `meses` (que NO es columna de
        # `Pago` -- se guarda como `meses_comprados` en el snapshot de abajo).
        # Repartir el `model_dump()` a mano evita las dos trampas: `meses`
        # colándose como kwarg inexistente, y `monto` quedando sin proveer.
        pago = Pago(
            tipo_pago=datos.tipo_pago,
            persona_id=datos.persona_id,
            membresia_id=datos.membresia_id,
            estado_pago=EstadoPago.PENDIENTE_VALIDACION,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
        pago.monto = monto_final
        if descuento_congelado is not None:
            pago.descuento_id = descuento_congelado.descuento_id
            pago.descuento_valor_aplicado = descuento_congelado.valor_aplicado
            pago.descuento_porcentaje_aplicado = descuento_congelado.porcentaje_aplicado
            pago.descuento_autorizado_por_persona_id = descuento_congelado.autorizado_por_persona_id

        # Snapshot de tarifa (issue #400, migración c1f4b8e2a706): congelar
        # acá los tres valores que este método YA calculó arriba, para que
        # el historial no dependa de `membresia.monto_aplicado` (mutable) ni
        # de una futura re-derivación contra un catálogo que puede cambiar
        # (ver docstring de `actualizar_tipo_membresia`). `monto_base` es
        # `precio_mensual * meses`, el monto ANTES de
        # `_congelar_beneficio_activo`/de la gratuidad -- `pago.monto` ya
        # quedó con el final (descontado, o cero si es gratuito) arriba.
        #
        # Slice 4c-b: se escribe SIEMPRE, incluso para un socio gratuito. La
        # condición vieja (`if precio_mensual > 0`) partía de una premisa que
        # esta misma rebanada rompe: que la ÚNICA forma de llegar con
        # `precio_mensual == 0` era la gratuidad familiar zereando la
        # tarifa. Desde que esa zereada no existe más, `tarifa_mensual_
        # aplicada`, `meses_comprados` y `monto_base` son, para CUALQUIER
        # pago (gratuito o no), el mismo hecho honesto: qué tarifa vigente,
        # cuántos meses y qué monto habría correspondido -- el cobro real
        # (`pago.monto`) es una columna aparte que sí puede ser $0 sin que
        # eso vuelva ambiguo o falso a este snapshot.
        pago.tarifa_mensual_aplicada = precio_mensual
        pago.meses_comprados = meses
        pago.monto_base = monto_base
        # Red de seguridad del invariante 1 (issue #8): si otra petición
        # concurrente registró su pendiente ENTRE el chequeo de arriba y este
        # INSERT, el índice `uq_pago_pendiente_por_membresia` lo rechaza y se
        # traduce al MISMO error de dominio que habría dado el chequeo. El
        # `rollback()` es obligatorio: un flush fallido deja la sesión
        # inválida para cualquier uso posterior.
        try:
            resultado = self.repo.crear(pago)
            self.db.flush()
        except IntegrityError as error:
            self.db.rollback()
            if "uq_pago_pendiente_por_membresia" in str(error.orig):
                raise OperacionInvalida(MENSAJE_PAGO_PENDIENTE_DUPLICADO) from error
            raise
        return resultado

    # --- Issue #1402: pago presencial de primera inscripción -----------------
    def registrar_pago_presencial(
        self,
        datos: PagoCreateDTO,
        persona_id_solicitante: int | None,
        roles_solicitante: list[str] | None,
    ) -> Pago:
        """Primer pago de inscripción anotado EN PERSONA por un admin (#1402).

        Producto: el socio está en el club, paga en efectivo (o pasa su
        transferencia frente al admin) y la membresía debe quedar ACTIVA en
        el mismo acto, sin un segundo paso humano de revisión -- pero con la
        MISMA auditoría de siempre (`validado_por_persona_id` +
        `fecha_validacion`) porque la aprobación la ejecuta
        `validar_pago`, no una bifurcación nueva.

        Por qué endpoint aparte y no una bandera en `POST /pagos`: la
        bandera sería un campo seteable por el cliente (#1402 lo prohíbe
        explícitamente) y bastaría un `curl` de un ALUMNO para intentar
        autoaprobarse. Acá la ruta exige `GestorPermisos(ROL_ADMIN)` y el
        servicio re-verifica las tres condiciones que hacen segura la
        aprobación inmediata, todas del lado del servidor:

        1. En persona: el admin registra para OTRA persona. El pago propio
           de un admin es autoservicio y nunca se autoaprueba (mismo camino
           que el resto: `POST /pagos` + cola de validación).
        2. Primera inscripción: la membresía está INACTIVA y NO tiene ni
           un pago APROBADO previo (`fecha_fin_maxima_aprobada is None`).
           Renovaciones, reactivaciones y segundas inscripciones quedan
           fuera por definición del producto.
        3. Evidencia completa ANTES de aprobar:
           - EFECTIVO: la evidencia es el acto mismo del cobro (un pago en
             efectivo nunca lleva voucher, issue #452) → se aprueba acá.
           - TRANSFERENCIA: la evidencia es el voucher, que sube por una
             petición SEPARADA (`POST /pagos/{id}/voucher`) → el pago
             queda PENDIENTE_VALIDACION. Nunca se aprueba sin voucher:
             cuando el voucher ya está, el admin finaliza por el endpoint
             admin-only `PATCH /pagos/{id}/validar` (camino normal, sin
             excepción auditada); si la subida falla, el pago sigue
             pendiente y el reintento vuelve a ser seguro.

        La cola de aprobación (activación, gratuidad familiar, notificación,
        correo y disparo del PDF) no se duplica: se delega entera a
        `validar_pago`, cuya guardia de estado + lock `FOR UPDATE` además
        serializa esta aprobación contra cualquier validación concurrente
        del mismo pago.

        No es una sola transacción: `registrar_pago` commitea el pendiente y
        `validar_pago` commitea la aprobación. La ventana de degradación es
        segura por construcción -- si el proceso muere entre ambos commits,
        el pago queda exactamente como en el flujo de siempre
        (PENDIENTE_VALIDACION, aprobable desde la cola); jamás queda
        aprobado sin evidencia, que es el único desenlace inaceptable.
        """
        # Autoría fail-closed (issue #458, mismo criterio que `validar_pago`):
        # sin `persona_id` en el token no hay admin identificable que firmar
        # la aprobación -- la ruta ya exigió rol ADMINISTRADOR, pero el actor
        # explícito es quien queda en la auditoría.
        if persona_id_solicitante is None:
            raise PermisosInsuficientes(
                "No se pudo identificar al administrador que registra el pago "
                "presencial.",
                detalle_tecnico="pago presencial: token sin persona_id",
            )

        # Guardia 1: en persona, nunca autoservicio. `GestorPermisos` ya
        # garantiza el rol; esto evita que un admin use el camino de
        # aprobación inmediata para su propia membresía.
        if persona_id_solicitante == datos.persona_id:
            raise OperacionInvalida(MENSAJE_PAGO_PRESENCIAL_PROPIO)

        # Guardia 2: primera inscripción (membresía inicial INACTIVA, sin
        # ningún pago aprobado). La lectura es `FOR UPDATE` (hallazgo del
        # revisor de #1402): con la lectura sin lock, dos peticiones
        # concurrentes (o una presencial y una aprobación de la cola que se
        # cruza) leían la misma membresía INACTIVA antes de que cualquiera
        # commiteara, ambas pasaban esta guardia con el dato vencido y la
        # segunda aprobaba un SEGUNDO pago como si fuera primera
        # inscripción. Bajo el MISMO lock de fila que `registrar_pago`
        # re-adquiere (no-op: misma transacción, mismo método) y que toda
        # aprobación competidora retiene desde su UPDATE de activación hasta
        # el commit, el perdedor de la carrera queda bloqueado acá, relee el
        # estado ya commiteado (ACTIVA o con pago aprobado) y la guardia lo
        # rechaza: la elegibilidad se decide con el mismo dato que verá el
        # registro y la aprobación. Sin deadlock nuevo: `registrar_pago`
        # commitea y suelta este lock ANTES de que `validar_pago` tome el
        # del pago (mismo orden [pago -> membresía] que cualquier
        # `validar_pago` de la cola), y la espera acá está acotada por
        # `lock_timeout` (issue #451: el perdedor recibe 409, nunca cuelga).
        membresia = self.repo_membresia.obtener_por_id_con_bloqueo(datos.membresia_id)
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {datos.membresia_id} no encontrada")
        es_primera_inscripcion = (
            membresia.estado == EstadoMembresia.INACTIVA
            and self.repo.fecha_fin_maxima_aprobada(membresia.id) is None
        )
        if not es_primera_inscripcion:
            raise OperacionInvalida(MENSAJE_PAGO_PRESENCIAL_NO_PRIMERA_INSCRIPCION)

        # Mismo camino de registro de siempre: autorización (dueño/
        # representante/admin), pago cruzado, menores, duplicado pendiente,
        # derivación de cobertura y congelado de tarifa/descuento -- cero
        # lógica nueva de registro.
        pago = self.registrar_pago(
            datos,
            persona_id_solicitante=persona_id_solicitante,
            roles_solicitante=roles_solicitante,
        )

        # Guardia 3: evidencia completa antes de aprobar (ver docstring).
        # TRANSFERENCIA vuelve PENDIENTE_VALIDACION: su evidencia (voucher)
        # viaja en otra petición y la aprobación final es el `validar`
        # admin-only de siempre.
        if pago.tipo_pago != TipoPago.EFECTIVO:
            return pago

        # EFECTIVO: cola de validación completa reusada, con auditoría de
        # revisor y tiempo (`validado_por_persona_id`/`fecha_validacion`).
        return self.validar_pago(
            pago.id,
            PagoValidarDTO(estado_pago=EstadoPago.APROBADO),
            actor_persona_id=persona_id_solicitante,
        )

    # --- Issue #398/3c: beneficio del pagador, resuelto server-side --------
    def _congelar_beneficio_activo(
        self, persona_id: int, monto_base: Decimal,
    ) -> tuple[_DescuentoCongelado | None, Decimal]:
        """Resuelve la asignación de beneficio VIGENTE de `persona_id`
        (`AsignacionDescuento.retirado_en IS NULL`, ver
        `AsignacionDescuentoRepositorio.obtener_activa_por_persona`) y
        devuelve (descuento congelado o `None`, monto final del pago).

        Reemplaza a la vieja `_congelar_descuento` (issue #11): antes el
        cliente elegía el descuento en cada pago (solo un ADMINISTRADOR podía
        enviarlo); ahora `PagoCreateDTO` ya no tiene ningún campo de
        descuento -- el backend resuelve el beneficio que el club ya le
        concedió a la persona por separado (issue #398). Un
        `descuento_ids` que el cliente mande igual nunca llega hasta acá:
        Pydantic lo descarta al parsear el DTO (ver su docstring).

        Invariantes firmados (docs/product/concepto-alcance-modelo.md §4,
        issue #398 "seguridad e invariantes"), sin cambios de fondo:
        - Valor congelado: se copia el valor calculado HOY (y el porcentaje
          vigente, si aplica) contra el `Descuento` de la asignación. Cambios
          posteriores al catálogo o a la asignación no alteran estas columnas
          -- son el hecho histórico.
        - Tope: el descuento no supera el monto base (100 %); no existen
          pagos negativos. Un pago de $0 (beca total) es válido y sigue el
          flujo normal de registro + aprobación.
        - `autorizado_por_persona_id` es SIEMPRE `asignacion.
          asignado_por_persona_id` -- el admin que CONCEDIÓ el beneficio,
          nunca quien registra este pago en particular (ver docstring de
          `Pago.descuento_autorizado_por_persona_id`).

        A diferencia de la vieja `_congelar_descuento`, acá NO se exige
        `descuento.activo`: un descuento inactivo no puede ASIGNARSE
        (`BeneficioServicio.asignar` ya lo rechaza), pero desactivarlo del
        catálogo después no retira los beneficios ya concedidos con él --
        mismo diseño documentado en `AsignacionDescuento` (issue #398). Si la
        asignación sigue vigente, el pago la aplica sin importar el estado
        actual del catálogo.
        """
        asignacion = self.repo_asignacion.obtener_activa_por_persona(persona_id)
        if asignacion is None:
            return None, monto_base

        descuento = self.repo_descuento.obtener_por_id(asignacion.descuento_id)
        if not descuento:
            # Defensivo: el catálogo solo se da de baja (`activo=False`),
            # nunca se borra, así que esto no debería ocurrir en la práctica.
            # Tratarlo como "sin beneficio" es más seguro que reventar el
            # registro de un pago legítimo por una fila de catálogo ausente.
            return None, monto_base

        if descuento.porcentaje is not None:
            valor = (monto_base * descuento.porcentaje / Decimal("100")).quantize(
                Decimal("0.01")
            )
        else:
            valor = descuento.monto

        if valor > monto_base:
            raise OperacionInvalida(
                "El beneficio asignado no puede superar el 100% del monto "
                f"del pago (monto base {formatear_monto_usd(monto_base)}, descuento {formatear_monto_usd(valor)})"
            )
        return (
            _DescuentoCongelado(
                descuento_id=descuento.id,
                asignacion_id=asignacion.id,
                valor_aplicado=valor,
                porcentaje_aplicado=descuento.porcentaje,
                autorizado_por_persona_id=asignacion.asignado_por_persona_id,
            ),
            monto_base - valor,
        )

    # --- Issue #400/4d (hallazgo del revisor, reproducido en vivo contra
    # Postgres real): "cobertura" es un hecho que hoy vive en DOS tablas
    # (`Pago` aprobado y `cobertura_bonificada`), y cada camino que ancla o
    # verifica solapamiento debe mirar las DOS -- nunca solo la suya. Antes
    # de este fix, `registrar_pago` anclaba SOLO contra `Pago`: una persona
    # con cobertura bonificada vigente hasta noviembre podía registrar (y
    # aprobar) un pago normal que arrancaba HOY, solapando esos meses ya
    # cubiertos. Estos dos helpers son el ÚNICO lugar donde vive la
    # combinación de ambas tablas -- `registrar_pago`, `regularizar_deuda` y
    # `aplicar_beneficio_bonificado` los llaman en vez de reimplementar la
    # combinación cada uno por su cuenta (así fue exactamente como se
    # introdujo el bug: dos implementaciones que fueron divergiendo).
    def _exigir_cobertura_vigente_sin_descuento(
        self, membresia_id: int, es_admin: bool = False,
    ) -> None:
        """T5/S5 (L5): si la cobertura vigente más lejana (pago aprobado o
        pendiente, o cobertura bonificada, que termine después de hoy) se
        obtuvo con descuento, el socio no puede pagar otra hasta que termine.
        Solo para flujos iniciados por el socio; el administrador no pasa
        por acá (`es_admin`)."""
        if es_admin:
            return
        hoy = hoy_club()
        pago = self.repo.ultima_cobertura_vigente(membresia_id, hoy)
        fin_bonificada = self.repo_cobertura_bonificada.fecha_fin_maxima_posterior_a(
            membresia_id, hoy,
        )
        candidatos = [(fin_bonificada, True)] if fin_bonificada is not None else []
        if pago is not None:
            candidatos.append(pago)
        if not candidatos:
            return
        fin, con_descuento = max(candidatos, key=lambda c: (c[0], c[1]))
        if con_descuento:
            raise OperacionInvalida(
                "Tu mes actual se pagó con descuento. Podrás renovar cuando "
                f"termine, el {fin.strftime('%d/%m/%Y')}."
            )

    def _fecha_fin_maxima_combinada(self, membresia_id: int) -> date | None:
        """`fecha_fin` más lejana entre AMBAS fuentes de cobertura de una
        membresía, o `None` si no tiene ninguna. El ancla real de "hasta
        cuándo ya está cubierta esta membresía", sin importar por cuál de
        los dos caminos se cubrió."""
        return _maximo_fecha_opcional(
            self.repo.fecha_fin_maxima_aprobada(membresia_id),
            self.repo_cobertura_bonificada.fecha_fin_maxima(membresia_id),
        )

    # Issue #1328: versión pública y en bloque de `_fecha_fin_maxima_
    # combinada` -- el portal del alumno (`GET /membresias/mias`, admin-less)
    # necesita esta misma ancla para el campo `cubiertoHasta` de
    # `MembresiaResponseDTO`, y `MembresiaServicio` (quien arma esa
    # respuesta) no tiene los repos de `Pago`/`CoberturaBonificada` -- nunca
    # debería tenerlos, ver el comentario de `obtener_deuda`/`obtener_deuda_
    # bulk` un poco más abajo sobre por qué esta superficie vive acá. Público
    # (sin guion bajo) porque el router la llama directo, a diferencia de la
    # versión de una sola membresía, que solo usan métodos internos de esta
    # clase. UNA consulta agrupada por fuente (`fecha_fin_maxima_aprobada_
    # bulk`/`fecha_fin_maxima_bulk`), nunca una por membresía -- mismo patrón
    # que `obtener_deuda_bulk` (issue #326) ya usa para las mismas dos
    # fuentes.
    def fecha_fin_maxima_combinada_bulk(self, membresia_ids: list[int]) -> dict[int, date | None]:
        if not membresia_ids:
            return {}
        fin_pagos = self.repo.fecha_fin_maxima_aprobada_bulk(membresia_ids)
        fin_cobertura = self.repo_cobertura_bonificada.fecha_fin_maxima_bulk(membresia_ids)
        return {
            membresia_id: _maximo_fecha_opcional(fin_pagos.get(membresia_id), fin_cobertura.get(membresia_id))
            for membresia_id in membresia_ids
        }

    def _hay_cobertura_en_rango(
        self,
        membresia_id: int,
        fecha_inicio: date,
        fecha_fin: date,
        *,
        medio_abierto: bool,
        excluir_pago_id: int | None = None,
    ) -> bool:
        """True si CUALQUIERA de las dos tablas ya cubre (total o
        parcialmente) el rango dado para esta membresía.

        `medio_abierto` decide qué variante de cada repositorio usar:
        `regularizar_deuda` recibe fechas EXPLÍCITAS del admin y ya usaba
        semántica CERRADA (`cobertura_aprobada_en_rango`) desde antes de
        este slice -- se preserva sin cambios para no alterar un
        comportamiento ya probado. `aplicar_beneficio_bonificado` ancla
        automáticamente un período justo donde terminó el anterior
        (`fecha_fin` de uno == `fecha_inicio` del siguiente), así que
        necesita la variante MEDIO ABIERTA -- con la cerrada, dos períodos
        apenas adyacentes se verían como solapados (bug real, ver
        `test_segunda_aplicacion_ancla_sobre_la_cobertura_bonificada_previa`).

        `excluir_pago_id` (issue #400/5b, usado solo por `corregir_pago`):
        el pago que se está corrigiendo sigue APROBADO durante todo el
        chequeo, con sus fechas VIEJAS -- sin excluirlo se solaparía
        consigo mismo y ninguna corrección de fecha podría pasar nunca esta
        guardia. `regularizar_deuda`/`aplicar_beneficio_bonificado` no
        pasan este argumento (ninguno de los dos corrige un pago existente),
        así que el default `None` no les cambia el comportamiento."""
        if medio_abierto:
            return (
                self.repo.cobertura_aprobada_en_rango_medio_abierto(membresia_id, fecha_inicio, fecha_fin)
                or self.repo_cobertura_bonificada.existe_en_rango(membresia_id, fecha_inicio, fecha_fin)
            )
        return (
            self.repo.cobertura_aprobada_en_rango(
                membresia_id, fecha_inicio, fecha_fin, excluir_pago_id=excluir_pago_id,
            )
            or self.repo_cobertura_bonificada.existe_en_rango_cerrado(membresia_id, fecha_inicio, fecha_fin)
        )

    def _calcular_meses_adeudados_desde_datos(
        self,
        *,
        estado: EstadoMembresia | None,
        ultimo_fin: date | None,
        fecha_reactivacion: datetime | None,
        hoy: date,
        periodicidad: PeriodicidadTarifa = PeriodicidadTarifa.MENSUAL,
    ) -> int:
        """Núcleo PURO de la deuda (issue #284/#400), con los datos YA
        resueltos en vez de leerlos de los repos -- las tres reglas de
        `calcular_meses_adeudados` (suspendida = 0, ancla combinada, reloj
        de reactivación) viven acá UNA sola vez.

        Issue #326: `calcular_meses_adeudados` (una membresía) y
        `obtener_deuda_bulk` (N membresías) llaman a este mismo método en
        vez de reimplementar la aritmética día-15/16 cada uno por su lado
        -- el camino bulk solo cambia CÓMO llegan `ultimo_fin`/
        `fecha_reactivacion` (3 consultas agrupadas en vez de 3*N), nunca
        el cálculo en sí.

        `estado=None` (membresía inexistente) se comporta igual que un
        estado que no es SUSPENDIDA -- mismo comportamiento que el código
        anterior a este refactor, que solo cortaba en 0 cuando la
        membresía existía y estaba SUSPENDIDA."""
        if estado == EstadoMembresia.SUSPENDIDA:
            return 0
        # "No acumula deuda": SEMANAL/DIARIA nunca deben meses.
        if periodicidad != PeriodicidadTarifa.MENSUAL:
            return 0
        if ultimo_fin is None:
            return 0
        if ultimo_fin >= hoy:
            return 0

        ancla = ultimo_fin
        if fecha_reactivacion is not None:
            dia_reactivacion = hoy_club(fecha_reactivacion)
            if dia_reactivacion > ancla:
                ancla = dia_reactivacion

        if ancla >= hoy:
            return 0
        return _meses_enteros_desde(ancla, hoy)

    def calcular_meses_adeudados(self, membresia_id: int) -> int:
        """Meses de deuda desde la última cobertura aprobada hasta hoy.

        Tres correcciones de issue #400 (slice 5a) sobre la cuenta pura de
        fechas que había antes:

        1. Mientras la membresía está SUSPENDIDA, la deuda es CERO sin
           importar cuán vieja sea la cobertura -- "Suspender detiene la
           generación de deuda futura" no admite excepción por antigüedad.
           Antes de este guard, esta función solo miraba `Pago.fecha_fin` y
           nunca `Membresia.estado`: alguien suspendido con cobertura vencida
           desde antes de suspenderse seguía figurando en mora.
        2. Tras REACTIVAR una membresía cuya cobertura ya había vencido, el
           reloj de mora arranca en la fecha de reactivación, no en el fin de
           cobertura original -- "los meses entre el fin de cobertura y la
           reactivación no generan deuda" (issue #400). El ancla es
           `max(fin_de_cobertura, fecha_efectiva_de_la_última_reactivación)`:
             - si la persona se reactivó DESPUÉS de que la cobertura venciera,
               ese máximo es la fecha de reactivación, y la deuda cuenta solo
               desde ahí (el hueco completo queda gratis).
             - si se reactivó con cobertura TODAVÍA vigente (`fin_de_cobertura`
               ya era mayor que la fecha de reactivación), el máximo sigue
               siendo `fin_de_cobertura`: esa cobertura real vale hasta que
               vence de verdad, sin ningún privilegio extra por haber pasado
               por una suspensión.
           Una membresía que nunca se suspendió no tiene ninguna fila de
           reactivación, así que el máximo colapsa al comportamiento de
           siempre (`fin_de_cobertura` solo) -- sin regresión para el caso
           común.
        3. `fin_de_cobertura` se lee de `_fecha_fin_maxima_combinada`
           (`Pago` aprobado Y `cobertura_bonificada`), no de `self.repo.
           fecha_fin_maxima_aprobada` (solo `Pago`) como antes (hallazgo del
           revisor, issue #400/5a). Es un defecto preexistente a este slice
           -- `aplicar_beneficio_bonificado` (4d) ya podía dejar la ÚNICA
           cobertura futura de una membresía en `cobertura_bonificada`, y
           esta función la ignoraba por completo, calculando deuda sobre un
           `Pago` viejo mientras la persona seguía cubierta gratis -- pero
           el ancla nueva de este slice (punto 2) se apoya sobre el mismo
           valor, así que corregirlo acá era necesario para no construir la
           corrección de hoy sobre un valor ya stale.
        """
        membresia = self.repo_membresia.obtener_por_id(membresia_id)
        if membresia is not None and not membresia.persona.activo:
            return 0
        ultimo_fin = self._fecha_fin_maxima_combinada(membresia_id)
        fecha_reactivacion = self.repo_historial_estado.fecha_efectiva_ultima_reactivacion(
            membresia_id,
        )
        return self._calcular_meses_adeudados_desde_datos(
            estado=membresia.estado if membresia is not None else None,
            ultimo_fin=ultimo_fin,
            fecha_reactivacion=fecha_reactivacion,
            hoy=hoy_club(),
            periodicidad=(
                membresia.tipo_membresia.periodicidad
                if membresia is not None else PeriodicidadTarifa.MENSUAL
            ),
        )

    def obtener_deuda_bulk(self, membresia_ids: list[int]) -> list[dict]:
        """Deuda en bloque (issue #326): N membresías con 4 consultas
        agrupadas (membresías + 3 fuentes de la ancla), nunca 1 consulta por
        membresía -- ver `PagoRepositorio.fecha_fin_maxima_aprobada_bulk`,
        `CoberturaBonificadaRepositorio.fecha_fin_maxima_bulk` y
        `HistorialEstadoMembresiaRepositorio.
        fecha_efectiva_ultima_reactivacion_bulk`.

        Ids duplicados se deduplican preservando el primer orden de
        aparición; ids que no resuelven a una membresía existente se omiten
        SILENCIOSAMENTE del resultado (mismo espíritu que
        `FichaMedicaRepositorio.listar_persona_ids_con_ficha`, issue #362:
        un id desconocido en un batch no debe 404 el batch entero).

        Contrato de 4 campos (decisión del owner, issue #326):
        `membresia_id`, `meses_adeudados`, `ultima_cobertura_fin`,
        `monto_mensual` -- sin `es_gratuidad_familiar` a propósito (fuera de
        alcance, ver el DTO)."""
        ids_unicos = list(dict.fromkeys(membresia_ids))
        if not ids_unicos:
            return []

        membresias = self.repo_membresia.listar_por_ids(ids_unicos)
        membresias_por_id = {m.id: m for m in membresias}
        ids_existentes = [mid for mid in ids_unicos if mid in membresias_por_id]
        if not ids_existentes:
            return []

        fin_pagos = self.repo.fecha_fin_maxima_aprobada_bulk(ids_existentes)
        fin_cobertura = self.repo_cobertura_bonificada.fecha_fin_maxima_bulk(ids_existentes)
        reactivaciones = self.repo_historial_estado.fecha_efectiva_ultima_reactivacion_bulk(ids_existentes)
        hoy = hoy_club()

        resultado = []
        for membresia_id in ids_existentes:
            membresia = membresias_por_id[membresia_id]
            ultimo_fin = _maximo_fecha_opcional(fin_pagos.get(membresia_id), fin_cobertura.get(membresia_id))
            resultado.append({
                "membresia_id": membresia_id,
                "meses_adeudados": 0 if not membresia.persona.activo else self._calcular_meses_adeudados_desde_datos(
                    estado=membresia.estado,
                    ultimo_fin=ultimo_fin,
                    fecha_reactivacion=reactivaciones.get(membresia_id),
                    hoy=hoy,
                    periodicidad=membresia.tipo_membresia.periodicidad,
                ),
                "ultima_cobertura_fin": ultimo_fin,
                "monto_mensual": membresia.monto_aplicado,
            })
        return resultado

    def obtener_deuda(self, membresia_id: int) -> dict:
        membresia = self.repo_membresia.obtener_por_id(membresia_id)
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")
        # Mismo ancla combinada que `calcular_meses_adeudados` (punto 3 de
        # su docstring): si difirieran, este campo de DISPLAY mentiría sobre
        # cuál es la cobertura real que `meses_adeudados` ya está usando.
        ultimo_fin = self._fecha_fin_maxima_combinada(membresia_id)
        return {
            "meses_adeudados": self.calcular_meses_adeudados(membresia_id),
            "ultima_cobertura_fin": ultimo_fin,
            "monto_mensual": membresia.monto_aplicado,
            # Issue #400 (slice 4c-a): este dict alimenta DeudaMembresiaResponseDTO,
            # que NO es ORM pass-through -- sin esta clave el campo llegaría
            # ausente aunque la columna exista en `membresia`.
            "es_gratuidad_familiar": membresia.es_gratuidad_familiar,
        }

    # --- Issue #400 (slice 5a): suspensión y reactivación ---------------------
    # Viven en PagoServicio, no en MembresiaServicio, por el mismo motivo que
    # `obtener_deuda`/`calcular_meses_adeudados`/`regularizar_deuda` ya viven
    # acá: las tres cosas son la misma superficie ("qué le pasa a la deuda y
    # a la cobertura de una membresía"), y las dos piezas que este par de
    # métodos necesita -- el ancla de cobertura (`_fecha_fin_maxima_
    # combinada`, que combina `Pago` Y `cobertura_bonificada`) y el
    # catálogo de tarifas vigente (`repo_tipo`) -- ya son vecinas de
    # `PagoServicio`, no de `MembresiaServicio` (que solo conoce `Membresia`,
    # `TipoMembresia` y `Persona`, y nunca tocó `Pago`). Partirlos en dos
    # clases habría obligado a `MembresiaServicio` a importar medio
    # `PagoServicio` solo para reactivar, o a duplicar `_fecha_fin_maxima_
    # combinada` -- ninguna de las dos gana claridad.
    def _validar_fecha_efectiva(self, membresia_id: int, efectiva: datetime) -> None:
        """Guardia compartida por `suspender_membresia`/`reactivar_membresia`
        (hallazgo del revisor, issue #400/5a): `fecha_efectiva` llega del
        DTO sin ningún límite -- `SuspensionReactivacionDTO` solo normaliza
        timezone, no fecha. Sin esta validación, un `fecha_efectiva` futuro
        en `reactivar_membresia` mueve el ancla de `calcular_meses_
        adeudados` (`max(fin_de_cobertura, fecha_reactivacion)`) hacia
        adelante en el tiempo -- la persona sale gratis hasta esa fecha
        fabricada, exactamente la clase de "meses gratis" que el issue
        prohíbe.

        Dos reglas, ambas a nivel de DÍA DE CALENDARIO DEL CLUB (`hoy_club`,
        no del instante exacto -- `fecha_efectiva` describe "desde qué día
        rige esto", igual que el resto del módulo trabaja en días, nunca en
        segundos):

        1. No puede ser POSTERIOR a hoy. Una transición no puede regir antes
           de ejecutarse. Mismo criterio ya establecido por `regularizar_
           deuda` (`datos.fecha_inicio > hoy` -> rechazado), reutilizado acá
           tal cual.
        2. No puede ser ANTERIOR a la `fecha_efectiva` de la transición
           previa de esta misma membresía (`HistorialEstadoMembresiaRepositorio.
           ultima_transicion`). Sin este chequeo, una reactivación backdateada
           a una fecha anterior a una suspensión previa podría hacer que
           `fecha_efectiva_ultima_reactivacion` (que ordena por `fecha_
           efectiva DESC`) devolviera la fila EQUIVOCADA como "la más
           reciente" -- la secuencia de `fecha_efectiva` de una membresía
           debe ser no-decreciente para que "más alta" siga significando
           "más reciente".

        Deliberadamente SIN techo de backdateo (a diferencia del límite de
        "no futuro", que sí existe): `regularizar_deuda`, en este mismo
        archivo, permite fechas retroactivas arbitrarias porque cubre meses
        adeudados reales sin límite de antigüedad, y una suspensión
        backdateada ("se ausentó desde el lunes", ver docstring del DTO) es
        la misma clase de corrección administrativa honesta. Inventar un
        límite arbitrario (30 días, 90 días) sería una regla de negocio sin
        base en el texto del issue; "no antes de la transición previa" es,
        en cambio, una restricción LÓGICA siempre verdadera, no una política.

        Filo conocido (dejado documentado, no resuelto acá -- fuera de
        alcance de este slice backend-only): un `fecha_efectiva` de
        medianoche UTC EXACTA cae del lado del día ANTERIOR en calendario
        del club (America/Guayaquil, UTC-5) -- ej. `2026-08-16T00:00:00Z`
        convierte a `2026-08-15 19:00` club. Un selector de fecha del
        frontend que serialice "solo fecha" como medianoche UTC (patrón
        común de `<input type=date>` + `Date.toISOString()`) correría el
        riesgo de mandar, sin quererlo, el día anterior al que el admin
        eligió. Cuando este endpoint tenga UI (fuera de #400/5a), esa
        pantalla debe enviar un instante real (`fecha_efectiva` con hora
        de guardado, no medianoche fabricada) o este chequeo debe pasar a
        comparar la FECHA que el cliente quiso decir en vez de convertir un
        instante -- ver el hallazgo en vivo en `test_suspension_
        reactivacion.py::test_suspender_con_fecha_efectiva_futura_es_
        rechazada`, que pisó exactamente este borde.
        """
        hoy = hoy_club()
        if hoy_club(efectiva) > hoy:
            raise OperacionInvalida(MENSAJE_FECHA_EFECTIVA_FUTURA)
        ultima = self.repo_historial_estado.ultima_transicion(membresia_id)
        if ultima is not None and efectiva < ultima.fecha_efectiva:
            raise OperacionInvalida(MENSAJE_FECHA_EFECTIVA_RETROCEDE)

    def suspender_membresia(
        self,
        membresia_id: int,
        motivo: str,
        actor_persona_id: int,
        fecha_efectiva: datetime | None = None,
    ) -> Membresia:
        """Suspende una membresía ACTIVA (issue #400): detiene la generación
        de deuda futura (ver `calcular_meses_adeudados`) y bloquea nuevos
        pagos (ver `registrar_pago`/`aplicar_beneficio_bonificado`). La
        cobertura ya pagada NO se toca -- ni una columna de `Pago` ni de
        `CoberturaBonificada` cambia acá; conserva su `fecha_fin` original
        tal cual la regla de negocio exige ("no se congela, no se extiende,
        no se convierte en saldo").

        Origen permitido: solo ACTIVA. VENCIDA e INACTIVA no tienen debajo
        ninguna deuda "corriendo" que suspender esté deteniendo (VENCIDA ya
        genera su propia mora por diseño; INACTIVA nunca tuvo cobertura), así
        que suspenderlas describiría una pausa sobre algo que no estaba en
        marcha. Una SUSPENDIDA no puede volver a suspenderse (usar
        `reactivar_membresia` primero) -- eso evitaría una segunda fila de
        historial con `estado_anterior == estado_nuevo`, que además el CHECK
        `ck_historial_estado_cambia` de la tabla rechazaría.

        Lee la membresía con `FOR UPDATE` (`obtener_por_id_con_bloqueo`,
        hallazgo del revisor, issue #400/5a): el índice único parcial
        `uq_membresia_activa_por_persona` solo impide que una fila DISTINTA
        ocupe el mismo slot -- no impide que dos llamados concurrentes sobre
        la MISMA fila (dos suspensiones/reactivaciones a la vez) lean el
        mismo estado de origen y las dos pasen la guardia. El lock serializa:
        el segundo llamado espera al commit del primero y relee el estado ya
        transicionado, así que lo rechaza la guardia normal de "estado de
        origen inválido" -- mismo mecanismo que `validar_pago` ya usa contra
        la doble aprobación de un pago (`obtener_por_id_con_bloqueo` en
        `pago_repositorio.py`).

        Escribe el nuevo estado y la fila de `HistorialEstadoMembresia` en UN
        solo commit (mismo patrón que `_activar_membresia_con_red_de_
        seguridad` + `repo.guardar_cambios(pago)` en `validar_pago`): la
        auditoría nunca debe quedar un paso atrás del estado real.
        """
        membresia = self.repo_membresia.obtener_por_id_con_bloqueo(membresia_id)
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")

        if not motivo or not motivo.strip():
            raise OperacionInvalida("Debes indicar el motivo de la suspensión.")

        if membresia.estado != EstadoMembresia.ACTIVA:
            raise OperacionInvalida(MENSAJE_SUSPENSION_ORIGEN_INVALIDO)

        efectiva = fecha_efectiva or datetime.now(timezone.utc)
        self._validar_fecha_efectiva(membresia_id, efectiva)

        estado_anterior = membresia.estado
        membresia.estado = EstadoMembresia.SUSPENDIDA
        self.db.add(
            HistorialEstadoMembresia(
                membresia_id=membresia.id,
                estado_anterior=estado_anterior,
                estado_nuevo=EstadoMembresia.SUSPENDIDA,
                fecha_efectiva=efectiva,
                actor_persona_id=actor_persona_id,
                motivo=motivo,
            )
        )
        resultado = self.repo_membresia.guardar_cambios(membresia)
        self.db.commit()
        if inspeccionar_orm(resultado).expired:
            self.db.refresh(resultado)
        return resultado

    def reactivar_membresia(
        self,
        membresia_id: int,
        motivo: str,
        actor_persona_id: int,
        fecha_efectiva: datetime | None = None,
    ) -> Membresia:
        """Reactiva una membresía SUSPENDIDA (issue #400).

        Operación de TRANSICIÓN DE ESTADO únicamente -- nunca otorga
        cobertura. No crea ningún `Pago` ni `CoberturaBonificada`:
          - Si la última cobertura combinada (`_fecha_fin_maxima_combinada`,
            que mira `Pago` Y `cobertura_bonificada`) todavía cubre hoy, esa
            cobertura sigue siendo válida sin más ("si vuelve antes del
            vencimiento, usa la cobertura que todavía sigue vigente") -- este
            método no necesita hacer nada especial para ese caso, solo
            flipear el estado; `calcular_meses_adeudados` ya lo resuelve
            (`ultimo_fin >= hoy` -> 0) sin mirar si hubo una suspensión.
          - Si la cobertura ya venció (o nunca existió), la persona queda
            ACTIVA pero SIN cobertura vigente: necesita un pago nuevo (fuera
            de alcance de este método, camino normal de `registrar_pago`,
            ahora desbloqueado porque el estado dejó de ser SUSPENDIDA). El
            "reloj de deuda" para ese pago futuro arranca en `fecha_efectiva`
            de ESTA reactivación, no en el fin de la cobertura vieja -- eso lo
            resuelve `calcular_meses_adeudados` leyendo el historial que este
            método escribe, no algo que se calcule acá.

        Resincroniza la tarifa (issue #400: "usa la tarifa vigente"):
        `Membresia.monto_aplicado` es una COPIA congelada en `crear_membresia`
        y nunca se resincroniza sola (ver docstring de
        `MembresiaServicio.actualizar_tipo_membresia`) -- si el catálogo
        cambió durante la suspensión, sin este resync la reactivación seguiría
        cobrando la tarifa vieja en el próximo pago. Se copia de nuevo desde
        `TipoMembresia.precio` con el mismo criterio "copia, no referencia"
        que usa el resto del módulo.

        Origen permitido: solo SUSPENDIDA. Lee la membresía con `FOR UPDATE`
        por la misma razón que `suspender_membresia` (ver su docstring):
        sin el lock, dos `reactivar_membresia(X)` concurrentes leen las dos
        `estado == SUSPENDIDA`, las dos pasan la guardia, y las dos
        commitean -- dos filas de historial para una sola transición lógica.
        """
        membresia = self.repo_membresia.obtener_por_id_con_bloqueo(membresia_id)
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")

        if not motivo or not motivo.strip():
            raise OperacionInvalida("Debes indicar el motivo de la reactivación.")

        if membresia.estado != EstadoMembresia.SUSPENDIDA:
            raise OperacionInvalida(MENSAJE_REACTIVACION_ORIGEN_INVALIDO)

        efectiva = fecha_efectiva or datetime.now(timezone.utc)
        self._validar_fecha_efectiva(membresia_id, efectiva)

        tipo = self.repo_tipo.obtener_por_id(membresia.tipo_membresia_id)
        if tipo is not None:
            membresia.monto_aplicado = tipo.precio

        estado_anterior = membresia.estado
        membresia.estado = EstadoMembresia.ACTIVA
        self.db.add(
            HistorialEstadoMembresia(
                membresia_id=membresia.id,
                estado_anterior=estado_anterior,
                estado_nuevo=EstadoMembresia.ACTIVA,
                fecha_efectiva=efectiva,
                actor_persona_id=actor_persona_id,
                motivo=motivo,
            )
        )
        try:
            resultado = self.repo_membresia.guardar_cambios(membresia)
            self.db.commit()
            if inspeccionar_orm(resultado).expired:
                self.db.refresh(resultado)
            return resultado
        except IntegrityError as error:
            self.db.rollback()
            if "uq_membresia_activa_por_persona" in str(error.orig):
                raise OperacionInvalida(MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA) from error
            raise

    @staticmethod
    def _exigir_un_periodo_si_corresponde(periodicidad: PeriodicidadTarifa, periodos: int) -> None:
        """Tarifa SEMANAL/DIARIA: un período por pago. `meses` (nombre del
        contrato) cuenta períodos de la tarifa; el selector de cantidad solo
        existe para MENSUAL."""
        if periodicidad != PeriodicidadTarifa.MENSUAL and periodos != 1:
            raise OperacionInvalida(MENSAJE_PERIODICIDAD_UN_PERIODO)

    @staticmethod
    def _exigir_tarifa_con_deuda(membresia: Membresia) -> None:
        if membresia.tipo_membresia.periodicidad != PeriodicidadTarifa.MENSUAL:
            raise OperacionInvalida(MENSAJE_PERIODICIDAD_SIN_DEUDA)

    def _cotizar_regularizacion(
        self, membresia: Membresia, fecha_inicio: date, fecha_fin: date,
        aplicar_descuento: bool = True,
    ) -> "_CotizacionRegularizacion":
        self._exigir_tarifa_con_deuda(membresia)
        meses = _meses_del_periodo(fecha_inicio, fecha_fin)
        monto_base = membresia.monto_aplicado * meses
        beneficio, monto_con_beneficio = self._congelar_beneficio_activo(
            membresia.persona_id, monto_base,
        )
        # QA owner R2 (S12): el admin elige entre el valor normal y el
        # descuento; el monto siempre se deriva acá, nunca del cliente.
        if aplicar_descuento:
            descuento, monto_esperado = beneficio, monto_con_beneficio
        else:
            descuento, monto_esperado = None, monto_base
        return _CotizacionRegularizacion(
            meses=meses,
            monto_base=monto_base,
            descuento=descuento,
            monto_esperado=monto_esperado,
            beneficio_disponible=beneficio,
        )

    def cotizar_regularizacion(
        self, membresia_id: int, fecha_inicio: date, fecha_fin: date,
        aplicar_descuento: bool = True,
    ) -> "_CotizacionRegularizacion":
        """Vista previa (solo lectura) del monto que `regularizar_deuda`
        exigirá para el período; el formulario del admin la usa para no
        pedir un monto a mano (QA3 ADM-09)."""
        membresia = self.repo_membresia.obtener_por_id(membresia_id)
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")
        if fecha_inicio >= fecha_fin:
            raise OperacionInvalida("La fecha de inicio debe ser anterior a la de fin.")
        return self._cotizar_regularizacion(
            membresia, fecha_inicio, fecha_fin, aplicar_descuento,
        )

    def regularizar_deuda(self, membresia_id: int, datos: RegularizacionDeudaDTO, persona_id_admin: int) -> Pago:
        """Regulariza deuda de una membresía (issue #284), operación SOLO de admin.

        La deuda es un valor DERIVADO (meses adeudados desde la última cobertura
        aprobada hasta hoy), no una columna. Este método permite al administrador
        cubrir casos puntuales con fechas retroactivas explícitas; admite cubrir
        una parte (1 de 4 meses salda ese mes y el resto sigue visible como deuda).

        También sirve para migrar socios existentes desde el cuaderno de pagos
        del club (issue #1492): el admin carga las fechas reales pagadas.

        Decisiones conservadoras (documentadas en el PR):
          * El pago entra APROBADO directo (no PENDIENTE_VALIDACION): es
            bookkeeping del admin, no un pago del cliente; la accountability
            viene de la auditoría (regularizada_por_persona_id, motivo, fecha).
          * Si el período regularizado cubre HOY (`fecha_inicio <= hoy <=
            fecha_fin`) la persona tiene cobertura real, así que la membresía
            se activa con `_activar_membresia_con_red_de_seguridad` (la misma
            de `validar_pago`) en el mismo commit que el pago; así es vigente,
            recibe el aviso de 5 días y entra en la transición a VENCIDA. Una
            regularización puramente retroactiva (`fecha_fin < hoy`) no toca
            el estado: la deuda parcial debe seguir visible.
          * Avisa al socio (campana + correo, ver `_notificar_regularizacion`)
            y, ya commiteado, encola el comprobante PDF oficial igual que
            `validar_pago` (un fallo al encolar no revierte nada); NO dispara
            la regla familiar.
          * `aplicar_descuento` (S12): `False` cobra el valor normal; ausente
            o `True` aplica el beneficio vigente.
          * Lockea la `Membresia` con `FOR UPDATE` antes de escribir, mismo
            orden (Membresia primero) que el resto de la clase.
          * `motivo` es OBLIGATORIO (ya validado por el DTO; se doble-chequea acá).
        """
        membresia = self.repo_membresia.obtener_por_id_con_bloqueo(membresia_id)
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")

        if not datos.motivo.strip():
            raise OperacionInvalida("Debes indicar el motivo de la regularización.")

        self._exigir_membresia_financieramente_operativa(membresia)
        self._exigir_tarifa_con_deuda(membresia)

        hoy = hoy_club()
        if datos.fecha_inicio > hoy:
            raise OperacionInvalida(
                "La regularización cubre meses adeudados; la fecha de inicio "
                "no puede ser posterior a hoy."
            )

        # Issue #400/4d (hallazgo del revisor): además del pago aprobado de
        # siempre, tampoco puede pisar un período ya cubierto por un
        # beneficio bonificado -- el admin no debe poder backdatear un pago
        # encima de una cobertura que la persona ya recibió gratis.
        if self._hay_cobertura_en_rango(
            membresia_id, datos.fecha_inicio, datos.fecha_fin, medio_abierto=False,
        ):
            raise OperacionInvalida(
                "El período indicado ya está cubierto por un pago aprobado "
                "o por un beneficio bonificado ya otorgado."
            )

        # QA3 ADM-09: el monto no es libre. Se deriva igual que en
        # `registrar_pago` (precio mensual x meses, menos el beneficio vigente
        # de la persona) y cualquier otro valor se rechaza con el esperado.
        cotizacion = self._cotizar_regularizacion(
            membresia, datos.fecha_inicio, datos.fecha_fin,
            aplicar_descuento=datos.aplicar_descuento is not False,
        )
        if datos.monto != cotizacion.monto_esperado:
            unidad_meses = "mes" if cotizacion.meses == 1 else "meses"
            detalle_beneficio = (
                f", menos el beneficio de {formatear_monto_usd(cotizacion.descuento_aplicado)}"
                if cotizacion.descuento is not None else ""
            )
            raise OperacionInvalida(
                f"El monto ({formatear_monto_usd(datos.monto)}) no coincide con el esperado para el "
                f"período: {formatear_monto_usd(cotizacion.monto_esperado)} "
                f"({cotizacion.meses} {unidad_meses} "
                f"x {formatear_monto_usd(membresia.monto_aplicado)}{detalle_beneficio})."
            )

        pago = Pago(
            monto=datos.monto,
            estado_pago=EstadoPago.APROBADO,
            tipo_pago=TipoPago.REGULARIZACION,
            fecha_validacion=datetime.now(timezone.utc),
            fecha_inicio=datos.fecha_inicio,
            fecha_fin=datos.fecha_fin,
            persona_id=membresia.persona_id,
            membresia_id=membresia_id,
            regularizada_por_persona_id=persona_id_admin,
            motivo_regularizacion=datos.motivo,
        )
        if cotizacion.descuento is not None:
            pago.descuento_id = cotizacion.descuento.descuento_id
            pago.descuento_valor_aplicado = cotizacion.descuento.valor_aplicado
            pago.descuento_porcentaje_aplicado = cotizacion.descuento.porcentaje_aplicado
            pago.descuento_autorizado_por_persona_id = cotizacion.descuento.autorizado_por_persona_id
        resultado = self.repo.crear(pago)
        if datos.fecha_inicio <= hoy <= datos.fecha_fin:
            self._activar_membresia_con_red_de_seguridad(membresia)
        self.db.commit()
        if inspeccionar_orm(resultado).expired:
            self.db.refresh(resultado)
        self._notificar_regularizacion(resultado)
        # Último paso, ya commiteado: no propaga si el broker está caído.
        self._disparar_generacion_comprobante_pdf(resultado.id)
        return resultado

    def _notificar_regularizacion(self, pago: Pago) -> None:
        """Avisa al socio que su deuda fue regularizada (QA owner R2, S13).

        Mismo mecanismo que la aprobación de un pago: fila in-app a nombre de
        la persona (el feed del representante la incluye por el #859, así que
        no se escribe una segunda) y correo al titular, o a su representante
        si es un menor sin cuenta. Best-effort: la regularización ya está
        commiteada y ningún aviso fallido puede revertirla ni convertirla en
        error."""
        vigente_hasta = self._fecha_fin_maxima_combinada(pago.membresia_id) or pago.fecha_fin
        # Tipo PAGO_APROBADO a propósito: `Notificacion.tipo` es un enum de
        # base de datos y agregar un valor exige migración. El encabezado
        # "Deuda regularizada" abre el mensaje.
        self._crear_notificacion_pago(
            pago=pago,
            tipo=TipoNotificacion.PAGO_APROBADO,
            mensaje=(
                f"Deuda regularizada: el club regularizó tu deuda por {formatear_monto_usd(pago.monto)}. "
                f"Tu cobertura está al día hasta el {vigente_hasta.strftime('%d/%m/%Y')}."
            ),
        )
        self._enviar_correo_de_validacion_pago(
            pago, TipoNotificacion.PAGO_APROBADO, regularizacion=True,
        )

    # --- Issue #400 (slice 5b): corrección financiera -------------------------
    # Seis campos financieros congelados de `Pago`. Un DTO puede traer
    # cualquier subconjunto de ellos (mismo criterio de "solo lo que cambia"
    # que `TipoMembresiaUpdateDTO`); los que no llegan conservan su valor
    # anterior tal cual.
    _CAMPOS_CORREGIBLES_PAGO = (
        "tarifa_mensual_aplicada", "meses_comprados", "monto_base",
        "monto", "fecha_inicio", "fecha_fin",
    )

    def corregir_pago(
        self, pago_id: int, datos: CorreccionPagoDTO, actor_persona_id: int,
    ) -> tuple[Pago, CorreccionPago]:
        """Corrige uno o más de los seis campos financieros congelados de un
        `Pago` YA APROBADO (issue #400, slice 5b), citando el texto del
        issue: "Toda corrección conserva: pago original; valores anteriores
        y nuevos; motivo obligatorio; administrador; fecha; efecto explícito
        sobre cobertura. No se permite borrar ni sobrescribir el rastro
        original."

        El `Pago` original SÍ se muta (los campos corregidos pasan a valer
        lo nuevo) pero CONSERVA SU ID -- a diferencia de `regularizar_deuda`,
        que crea una fila `Pago` nueva, esto es una corrección DEL MISMO
        pago, no un pago adicional. El rastro sobrevive en la fila
        `CorreccionPago` nueva, que jamás se sobrescribe.

        Lockea la `Membresia` PRIMERO y el `Pago` DESPUÉS (issue #400/5b,
        hallazgo del revisor): antes de este slice un `Pago` APROBADO era
        inmutable, así que `registrar_pago` podía leer su ancla de cobertura
        (`_fecha_fin_maxima_combinada`) sin lock -- nunca había una
        escritura concurrente que la corriera. Esta corrección introduce
        esa ventana: reduce/amplía `fecha_fin` de un pago YA aprobado
        mientras otra transacción podría estar registrando un pago nuevo
        anclado en el valor viejo. El lock de `Membresia`
        (`obtener_por_id_con_bloqueo`, mismo método que `suspender_
        membresia`/`reactivar_membresia`) serializa contra ese
        `registrar_pago` concurrente -- que ahora también lockea la
        `Membresia` antes de leer el ancla. El orden (Membresia primero,
        Pago después) es el MISMO en toda esta clase -- ningún otro método
        toma los dos locks al revés -- así que no hay ciclo posible de
        deadlock. Recién después se lockea el `Pago` con `FOR UPDATE`
        (mismo mecanismo que `validar_pago`): dos correcciones concurrentes
        del MISMO pago se serializan -- la segunda espera el commit de la
        primera y relee los valores ya corregidos, así que sus deltas
        ("anterior") reflejan la corrección previa en vez de pisarla en
        silencio.

        Guardia de estado: solo un pago APROBADO tiene algo financiero que
        "corregir" -- uno PENDIENTE_VALIDACION todavía no fijó nada, y uno
        RECHAZADO nunca cobró.

        Si ningún campo efectivamente cambia, se rechaza: una "corrección"
        que no corrige nada no es una corrección (mismo criterio que el
        CHECK `ck_correccion_pago_algun_campo_cambia` en la base).

        Consistencia cruzada entre los seis campos (issue #400/5b, hallazgo
        del revisor): estos campos no son independientes entre sí --
        `fecha_fin` se deriva de `fecha_inicio` + `meses_comprados`
        (`_sumar_meses`, mismo cálculo que `registrar_pago`), `monto_base`
        se deriva de `tarifa_mensual_aplicada * meses_comprados`, y `monto`
        se deriva de `monto_base` menos el descuento YA congelado del pago
        (`Pago.descuento_valor_aplicado`, que este DTO NO permite corregir).
        Sin este chequeo, un admin podía corregir `meses_comprados` solo,
        dejando `fecha_fin` describiendo un período que ya no coincide con
        lo que el pago dice haber comprado -- exactamente la clase de "dato
        con forma de bueno que no lo es" que `ck_pago_snapshot_completo_o_
        ausente` ya previene para el caso NULL/NOT NULL. Cada una de las
        tres validaciones corre SOLO si el DTO tocó alguno de los campos
        que esa fórmula relaciona -- una corrección que no toca ninguno de
        los campos de una fórmula no puede haberla desalineado.

        Si `fecha_inicio`/`fecha_fin` cambian, se valida contra la
        ENVOLVENTE del rango VIEJO y el NUEVO (`min`/`max` de ambos), no
        solo el rango nuevo -- un solape puro no puede detectar un HUECO:
        `registrar_pago` ancla cada pago nuevo exactamente donde terminó el
        anterior (`fecha_inicio = ultima_fecha_fin`, ver `_sumar_meses` más
        arriba), así que si este pago reduce su `fecha_fin` de 30/06 a
        20/06 y un pago POSTERIOR ya ancló su `fecha_inicio` en 30/06, el
        rango NUEVO ([.., 20/06]) por sí solo NUNCA se solapa con el
        posterior ([30/06, ..]) -- un hueco, por definición, no es un
        solape. La ENVOLVENTE ([.., 30/06], que incluye el borde viejo)
        SÍ se solapa con ese posterior tocando exactamente en 30/06, y
        `_hay_cobertura_en_rango` (semántica CERRADA, mismo criterio que
        `regularizar_deuda`) trata un borde compartido como solape -- por
        eso alcanza con extenderla a la envolvente en vez de escribir un
        chequeo de huecos aparte. Decisión de diseño ya tomada (no
        reabrir): reducir la `fecha_fin` de un pago aprobado cuando otro
        pago posterior ancló su `fecha_inicio` justo ahí se rechaza, en vez
        de permitir un hueco silencioso en la cadena de cobertura.

        `efecto_cobertura` se calcula comparando `fecha_fin` anterior contra
        la nueva: igual -> `SIN_CAMBIO`; posterior -> `AMPLIADA`; anterior
        -> `REDUCIDA`. Se persiste en la fila de corrección, nunca queda
        implícito.
        """
        # Existencia primero -- consulta de UNA SOLA COLUMNA
        # (`obtener_membresia_id`), nunca `Session.get(Pago, ...)` sin lock:
        # ver el docstring de `PagoRepositorio.obtener_membresia_id` para el
        # porqué (identity map + `with_for_update` es una combinación que
        # silenciosamente no lockea nada si el objeto ya está cacheado).
        membresia_id = self.repo.obtener_membresia_id(pago_id)
        if membresia_id is None:
            raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")

        # Lock de `Membresia` PRIMERO, `Pago` DESPUÉS -- ver el docstring de
        # arriba para el porqué (orden consistente con el resto de la clase,
        # sin ciclo posible de deadlock).
        self.repo_membresia.obtener_por_id_con_bloqueo(membresia_id)

        pago = self.repo.obtener_por_id_con_bloqueo(pago_id)
        if not pago:
            raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")

        if not datos.motivo.strip():
            raise OperacionInvalida("Debes indicar el motivo de la corrección.")

        if pago.estado_pago != EstadoPago.APROBADO:
            raise OperacionInvalida(
                "Solo un pago aprobado puede corregirse; este pago está "
                f"{estado_de_pago_en_castellano(pago.estado_pago)}.",
                detalle_tecnico=f"pago_id={pago_id} estado_pago={pago.estado_pago.value}",
            )

        anteriores = {
            campo: getattr(pago, campo) for campo in self._CAMPOS_CORREGIBLES_PAGO
        }
        nuevos = {
            campo: (
                valor_dto if (valor_dto := getattr(datos, campo)) is not None
                else anteriores[campo]
            )
            for campo in self._CAMPOS_CORREGIBLES_PAGO
        }

        # QA4 ADMA-16: si el admin solo manda el monto final, el servidor
        # deriva `monto_base` (monto + descuento congelado) y, si la división
        # es exacta en centavos, la tarifa mensual -- el admin no hace cuentas.
        if (
            datos.monto is not None
            and datos.monto_base is None
            and datos.tarifa_mensual_aplicada is None
            and datos.meses_comprados is None
            and anteriores["monto_base"] is not None
        ):
            monto_base_derivado = datos.monto + (pago.descuento_valor_aplicado or Decimal("0.00"))
            nuevos["monto_base"] = monto_base_derivado
            meses = nuevos["meses_comprados"]
            if meses is not None and nuevos["tarifa_mensual_aplicada"] is not None:
                tarifa_derivada = (monto_base_derivado / meses).quantize(Decimal("0.01"))
                if tarifa_derivada * meses == monto_base_derivado:
                    nuevos["tarifa_mensual_aplicada"] = tarifa_derivada

        if all(nuevos[campo] == anteriores[campo] for campo in self._CAMPOS_CORREGIBLES_PAGO):
            raise OperacionInvalida("La corrección no modifica ningún valor del pago.")

        def _tocado(campo: str) -> bool:
            return getattr(datos, campo) is not None

        # Consistencia cruzada (issue #400/5b, hallazgo del revisor): ver el
        # docstring de arriba. Cada validación corre SOLO si el DTO tocó
        # algún campo de la fórmula que verifica, y SOLO si los valores
        # EFECTIVOS involucrados existen (los tres campos de snapshot son
        # nullable para pagos históricos pre-#400 sin snapshot -- no hay
        # nada que validar contra un valor ausente).
        if _tocado("meses_comprados") or _tocado("fecha_inicio") or _tocado("fecha_fin"):
            membresia_del_pago = self.repo_membresia.obtener_por_id(pago.membresia_id)
            periodicidad_del_pago = (
                membresia_del_pago.tipo_membresia.periodicidad
                if membresia_del_pago is not None else PeriodicidadTarifa.MENSUAL
            )
            if (
                nuevos["meses_comprados"] is not None
                and nuevos["fecha_fin"] != _fin_de_cobertura(
                    nuevos["fecha_inicio"], nuevos["meses_comprados"], periodicidad_del_pago,
                )
            ):
                raise OperacionInvalida(
                    "La fecha de fin no coincide con la fecha de inicio más "
                    "la cantidad de meses comprados."
                )

        if _tocado("tarifa_mensual_aplicada") or _tocado("meses_comprados") or _tocado("monto_base"):
            if (
                nuevos["tarifa_mensual_aplicada"] is not None
                and nuevos["meses_comprados"] is not None
                and nuevos["monto_base"] is not None
                and nuevos["monto_base"] != nuevos["tarifa_mensual_aplicada"] * nuevos["meses_comprados"]
            ):
                raise OperacionInvalida(
                    "El monto base no coincide con la tarifa mensual "
                    "aplicada multiplicada por los meses comprados."
                )

        if _tocado("monto_base") or _tocado("monto"):
            if nuevos["monto_base"] is not None:
                descuento_congelado = pago.descuento_valor_aplicado or Decimal("0.00")
                if nuevos["monto"] != nuevos["monto_base"] - descuento_congelado:
                    raise OperacionInvalida(
                        "El monto final no coincide con el monto base menos "
                        "el descuento ya aplicado a este pago."
                    )

        fecha_inicio_nueva = nuevos["fecha_inicio"]
        fecha_fin_nueva = nuevos["fecha_fin"]
        if fecha_inicio_nueva >= fecha_fin_nueva:
            raise OperacionInvalida("La fecha de inicio debe ser anterior a la de fin.")

        if (
            fecha_inicio_nueva != anteriores["fecha_inicio"]
            or fecha_fin_nueva != anteriores["fecha_fin"]
        ):
            envolvente_inicio = min(fecha_inicio_nueva, anteriores["fecha_inicio"])
            envolvente_fin = max(fecha_fin_nueva, anteriores["fecha_fin"])
            if self._hay_cobertura_en_rango(
                pago.membresia_id, envolvente_inicio, envolvente_fin,
                medio_abierto=False, excluir_pago_id=pago.id,
            ):
                raise OperacionInvalida(
                    "El período corregido se superpone o rompe la continuidad "
                    "con la cobertura de otro pago aprobado, o de un beneficio "
                    "bonificado, de esta membresía."
                )

        if fecha_fin_nueva == anteriores["fecha_fin"]:
            efecto = EfectoCoberturaCorreccion.SIN_CAMBIO
        elif fecha_fin_nueva > anteriores["fecha_fin"]:
            efecto = EfectoCoberturaCorreccion.AMPLIADA
        else:
            efecto = EfectoCoberturaCorreccion.REDUCIDA

        for campo in self._CAMPOS_CORREGIBLES_PAGO:
            setattr(pago, campo, nuevos[campo])

        correccion = CorreccionPago(
            pago_id=pago.id,
            tarifa_mensual_aplicada_anterior=anteriores["tarifa_mensual_aplicada"],
            tarifa_mensual_aplicada_nuevo=nuevos["tarifa_mensual_aplicada"],
            meses_comprados_anterior=anteriores["meses_comprados"],
            meses_comprados_nuevo=nuevos["meses_comprados"],
            monto_base_anterior=anteriores["monto_base"],
            monto_base_nuevo=nuevos["monto_base"],
            monto_anterior=anteriores["monto"],
            monto_nuevo=nuevos["monto"],
            fecha_inicio_anterior=anteriores["fecha_inicio"],
            fecha_inicio_nuevo=fecha_inicio_nueva,
            fecha_fin_anterior=anteriores["fecha_fin"],
            fecha_fin_nuevo=fecha_fin_nueva,
            motivo=datos.motivo,
            actor_persona_id=actor_persona_id,
            efecto_cobertura=efecto,
        )
        self.db.add(correccion)
        pago_guardado = self.repo.guardar_cambios(pago)
        self.db.commit()
        if inspeccionar_orm(pago_guardado).expired:
            self.db.refresh(pago_guardado)
        if inspeccionar_orm(correccion).expired:
            self.db.refresh(correccion)
        return pago_guardado, correccion

    def listar_correcciones_de_pago(self, pago_id: int) -> list[CorreccionPago]:
        """Historial completo de correcciones financieras de un pago (issue
        #400/5b) -- el rastro que el issue exige que se "conserve" tiene que
        ser consultable, no solo escribible."""
        return self.repo.listar_correcciones_por_pago(pago_id)

    # --- Issue #400 (slice 4d): cobertura bonificada -------------------------
    def aplicar_beneficio_bonificado(
        self,
        membresia_id: int,
        datos: CoberturaBonificadaCreateDTO,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> CoberturaBonificada:
        """Otorga cobertura bonificada: cuando el beneficio 100% personal
        vigente del titular cubre el monto base COMPLETO del período
        elegido, la persona recibe cobertura sin que se cree ningún `Pago`
        -- ver el docstring de `CoberturaBonificada` en `modelos.py` para el
        porqué de la tabla dedicada (nunca un método/comprobante/PDF
        inventados).

        Autorización: autoservicio del PAGADOR (dueño o su representante),
        NUNCA un ADMINISTRADOR "por" él. El admin ya ejerció su parte del
        proceso al conceder la `AsignacionDescuento` (issue #398, admin-only,
        ver `BeneficioServicio.asignar`); aplicarla a un período concreto es
        un acto del propio pagador. A diferencia de `registrar_pago` (que sí
        deja pasar a un ADMINISTRADOR, porque puede legítimamente registrar
        una transferencia que presenció), acá no hay ningún movimiento de
        dinero que un admin deba poder atestiguar en nombre de un tercero --
        por eso el trío dueño/representante/admin de `registrar_pago` queda
        reducido a un dúo acá.

        Reglas de negocio, en orden:
          1. Gratuidad familiar (`membresia.es_gratuidad_familiar`): si la
             membresía YA es gratuita por la regla del 4to miembro
             (E04-RF002), aplicar un beneficio bonificado no corresponde --
             la cobertura ya es $0 por otro mecanismo. Mutuamente
             excluyentes por construcción, mismo gate que `registrar_pago`.
          2. El beneficio debe cubrir el 100% EXACTO del monto base de ESTE
             período (`_congelar_beneficio_activo`, misma matemática que
             `registrar_pago`). Issue #1369: el período es SIEMPRE un mes
             (`MESES_POR_ACTIVACION_BENEFICIO`) -- el cliente ya no lo elige,
             así que la base es `tarifa * 1`: un descuento porcentual del
             100% siempre alcanza, y uno de monto FIJO solo si ese monto
             iguala exactamente la tarifa mensual. Sin beneficio
             vigente, o un beneficio que cubre solo una parte, se rechaza:
             ese caso sigue el camino normal de `registrar_pago`, con un
             cobro real (posiblemente parcial).
          3. Período: mismo ancla que `registrar_pago` (fin de la última
             cobertura aprobada, o hoy), pero combinando el máximo de AMBAS
             tablas (`Pago` y `cobertura_bonificada`) -- una persona con
             cobertura bonificada hasta marzo que vuelve a aplicar el
             beneficio no debe pisar esos meses.
          4. Pre-check de solapamiento contra AMBAS tablas (pago aprobado O
             cobertura bonificada ya otorgada) -- camino primario de error;
             la restricción de exclusión
             `ex_cobertura_bonificada_periodo_no_solapa` es la red de
             seguridad ante la carrera que este pre-check no puede ver
             (issue #8, mismo criterio que el resto del módulo).

        Activa la membresía (a diferencia de `regularizar_deuda`, que es
        bookkeeping retroactivo y deliberadamente NO activa): la persona
        recibe cobertura real, mismo criterio que un pago aprobado
        (`validar_pago`), reutilizando su misma red de seguridad
        (`_activar_membresia_con_red_de_seguridad`).

        NO dispara generación de PDF ni crea `ComprobantePago` -- no hay
        nada que comprobar, no hubo transferencia ni efectivo. Tampoco es
        barrida por `reconciliar_comprobantes_faltantes` (esa tarea consulta
        `Pago`; esta tabla le es estructuralmente invisible). Sí crea una
        notificación in-app, pero con `TipoNotificacion.
        COBERTURA_BONIFICADA_OTORGADA` -- nunca `PAGO_APROBADO`, cuyo texto
        ("Su pago de $X fue aprobado") describiría un cobro que no ocurrió.

        Lock de `Membresia` (`obtener_por_id_con_bloqueo`, `SELECT ...
        FOR UPDATE`, issue #400/08): mismo patrón que `registrar_pago`/
        `suspender_membresia`/`reactivar_membresia`/`corregir_pago`/
        `cambiar_plan` -- este era el único de los seis métodos que muta
        estado de una `Membresia` sin tomarlo, apoyado solo en el `EXCLUDE`
        de Postgres `ex_cobertura_bonificada_periodo_no_solapa`. Ese
        `EXCLUDE` protege el solapamiento DENTRO de `cobertura_bonificada`,
        pero no puede ver una carrera contra `membresia.estado` (una
        suspensión concurrente) ni contra `pago.estado_pago` (una
        corrección concurrente sobre un pago aprobado de la misma
        membresía) -- ninguna de las dos toca la tabla que el `EXCLUDE`
        vigila. El lock serializa contra los cinco métodos hermanos igual
        que ya se serializan entre sí.
        """
        # Autorización primero, existencia después (issue #457): sin admin
        # de por medio en este método (ver docstring arriba), quien no es
        # dueño ni representante no debe poder distinguir "no existe" de
        # "existe pero no es mía" -- ambos casos caen en el mismo 403.
        roles_solicitante = roles_solicitante or []
        membresia = self.repo_membresia.obtener_por_id_con_bloqueo(membresia_id)

        es_duenio = (
            membresia is not None
            and persona_id_solicitante is not None
            and persona_id_solicitante == membresia.persona_id
        )
        es_representante = False
        if membresia is not None and not es_duenio and persona_id_solicitante is not None:
            persona_objetivo = self.repo_persona.obtener_por_id(membresia.persona_id)
            es_representante = bool(
                persona_objetivo and persona_objetivo.representante_id == persona_id_solicitante
            )
        if not (es_duenio or es_representante):
            raise PermisosInsuficientes(
                "Solo el titular de la membresía, o su representante, "
                "pueden aplicar su beneficio bonificado"
            )

        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")

        if membresia.es_gratuidad_familiar:
            raise OperacionInvalida(MENSAJE_MEMBRESIA_YA_GRATUITA)

        # Issue #400 (slice 5a): mismo gate que `registrar_pago`. Una
        # cobertura bonificada es, en los hechos, cobertura nueva otorgada a
        # la membresía -- si "suspender bloquea nuevos pagos", también debe
        # bloquear el único otro camino que produce cobertura sin pago, o el
        # gate de `registrar_pago` sería un agujero con nombre distinto.
        self._exigir_membresia_financieramente_operativa(membresia)

        # T5/S5 (L5): solo autoservicio, así que aplica siempre.
        self._exigir_cobertura_vigente_sin_descuento(membresia_id)

        precio_mensual = membresia.monto_aplicado
        # Issue #1369: el cuerpo (`CoberturaBonificadaCreateDTO`) ya no lleva
        # `meses` -- una activación otorga exactamente un mes, sin importar
        # lo que el cliente mande.
        meses = MESES_POR_ACTIVACION_BENEFICIO
        monto_base = precio_mensual * meses

        descuento_congelado, monto_final = self._congelar_beneficio_activo(
            membresia.persona_id, monto_base,
        )
        if descuento_congelado is None or monto_final != 0:
            raise OperacionInvalida(MENSAJE_BENEFICIO_NO_ES_TOTAL)

        ultima_fecha_fin = self._fecha_fin_maxima_combinada(membresia_id)
        hoy = hoy_club()
        ancla = max(ultima_fecha_fin, hoy) if ultima_fecha_fin is not None else hoy
        fecha_inicio = ancla
        fecha_fin = _fin_de_cobertura(
            ancla, meses, PeriodicidadTarifa(membresia.tipo_membresia.periodicidad),
        )

        if self._hay_cobertura_en_rango(
            membresia_id, fecha_inicio, fecha_fin, medio_abierto=True,
        ):
            raise OperacionInvalida(MENSAJE_COBERTURA_YA_APLICADA)

        self._activar_membresia_con_red_de_seguridad(membresia)

        cobertura = CoberturaBonificada(
            membresia_id=membresia_id,
            persona_id=membresia.persona_id,
            asignacion_descuento_id=descuento_congelado.asignacion_id,
            tarifa_mensual_aplicada=precio_mensual,
            meses_comprados=meses,
            # Congelamiento del valor del descuento (hallazgo del revisor):
            # copia lo que `_congelar_beneficio_activo` YA calculó arriba,
            # nunca una referencia viva al catálogo -- ver docstring de
            # `CoberturaBonificada` en modelos.py.
            descuento_valor_aplicado=descuento_congelado.valor_aplicado,
            descuento_porcentaje_aplicado=descuento_congelado.porcentaje_aplicado,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
            otorgada_por_persona_id=persona_id_solicitante,
        )
        try:
            cobertura = self.repo_cobertura_bonificada.crear(cobertura)
            # Un solo commit para membresía + cobertura (issue #831): antes,
            # `_activar_membresia_con_red_de_seguridad` flusheaba y
            # `repo_cobertura_bonificada.crear` comiteaba por separado -- acá
            # se confirman juntas.
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            if "ex_cobertura_bonificada_periodo_no_solapa" in str(error.orig):
                raise OperacionInvalida(MENSAJE_COBERTURA_YA_APLICADA) from error
            raise

        self._crear_notificacion(
            persona_id=membresia.persona_id,
            entidad_relacionada_id=cobertura.id,
            tipo=TipoNotificacion.COBERTURA_BONIFICADA_OTORGADA,
            # Issue #1369: la activación otorga siempre exactamente un mes.
            mensaje=(
                "Se te otorgó cobertura bonificada de 1 mes para tu membresía."
            ),
            id_para_log=f"cobertura bonificada {cobertura.id}",
        )
        # Issue #1369 (slice 2): aviso operativo a cada administrador activo,
        # después del commit de la cobertura y sin poder romperla.
        self._notificar_admins_cobertura(cobertura, membresia)
        # Issue #826/#451: este método corre dentro de `run_in_threadpool` y
        # el router arma la respuesta después, ya en el event loop.
        if inspeccionar_orm(cobertura).expired:
            self.db.refresh(cobertura)
        return cobertura

    def cobertura_bonificada_a_response_dto(
        self, cobertura: CoberturaBonificada,
    ) -> CoberturaBonificadaResponseDTO:
        """Punto único donde una `CoberturaBonificada` ORM se convierte en la
        respuesta HTTP, anidando la `AsignacionDescuento` (con su `Descuento`
        del catálogo dentro) -- mismo patrón que
        `BeneficioServicio.a_response_dto`, duplicado a propósito: ninguna de
        las dos clases depende de la otra (ver docstring de
        `BeneficioServicio` sobre por qué issue #398 y #400/4c/4d quedan
        deliberadamente separados).

        `descuento_valor_aplicado`/`descuento_porcentaje_aplicado` del DTO
        salen de LAS COLUMNAS CONGELADAS de `cobertura` (hallazgo del
        revisor), NUNCA del `descuento` que se lee acá abajo -- ese lookup
        es SOLO para nombrar/identificar el catálogo dentro de
        `asignacion_descuento.descuento` (issue #398), y puede haber
        cambiado de valor desde que se otorgó esta cobertura."""
        asignacion = self.repo_asignacion.obtener_por_id(cobertura.asignacion_descuento_id)
        descuento = self.repo_descuento.obtener_por_id(asignacion.descuento_id)
        return CoberturaBonificadaResponseDTO(
            id=cobertura.id,
            membresia_id=cobertura.membresia_id,
            persona_id=cobertura.persona_id,
            asignacion_descuento=AsignacionDescuentoResponseDTO(
                id=asignacion.id,
                persona_id=asignacion.persona_id,
                descuento=DescuentoResponseDTO.model_validate(descuento),
                asignado_por_persona_id=asignacion.asignado_por_persona_id,
                asignado_por_nombre=asignacion.asignado_por_nombre,
                asignado_en=asignacion.asignado_en,
                retirado_por_persona_id=asignacion.retirado_por_persona_id,
                retirado_en=asignacion.retirado_en,
            ),
            tarifa_mensual_aplicada=cobertura.tarifa_mensual_aplicada,
            meses_comprados=cobertura.meses_comprados,
            descuento_valor_aplicado=cobertura.descuento_valor_aplicado,
            descuento_porcentaje_aplicado=cobertura.descuento_porcentaje_aplicado,
            fecha_inicio=cobertura.fecha_inicio,
            fecha_fin=cobertura.fecha_fin,
            otorgada_por_persona_id=cobertura.otorgada_por_persona_id,
            otorgada_en=cobertura.otorgada_en,
        )

    def obtener_pago(
        self,
        pago_id: int,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> Pago:
        """Obtiene un pago por id, aplicando la misma autorización que sus
        hermanos (`listar_pagos_de_persona`, `registrar_pago`,
        `adjuntar_voucher`): dueño, su representante, o ADMINISTRADOR.

        Sin contexto de autorización (ambos parámetros en None) se comporta
        como antes: solo existencia. Ese modo es para los usos internos de
        esta misma clase -- `validar_pago`, `adjuntar_comprobante` y
        `adjuntar_voucher` ya validaron permisos en su propio nivel antes de
        llegar acá. Es el mismo convenio que `MembresiaServicio.obtener_membresia`.

        El endpoint `GET /membresias/pagos/{pago_id}` no pasaba ningún
        contexto, así que cualquier sesión autenticada podía leer el pago de
        cualquier otra persona: monto, y sobre todo `voucher_url`, que es la
        URL pública en Cloudinary del comprobante bancario que subió el socio.

        Autorización primero, existencia después (issue #457): ese fix dejó
        de filtrar monto/voucher_url a un tercero, pero seguía filtrando
        EXISTENCIA -- un solicitante sin ningún vínculo con el pago podía
        distinguir "no existe" (404) de "existe pero no es mío" (403)
        probando ids consecutivos. Solo un ADMINISTRADOR conserva esa
        distinción; para todos los demás, ambos casos caen en el mismo 403.
        """
        pago = self.repo.obtener_por_id(pago_id)

        if persona_id_solicitante is None and not roles_solicitante:
            if not pago:
                raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")
            return pago

        roles_solicitante = roles_solicitante or []
        es_admin = "ADMINISTRADOR" in roles_solicitante
        autorizado = es_admin or (
            pago is not None
            and PoliticaAccesoPersona(self.db).puede_acceder(
                persona_id_objetivo=pago.persona_id,
                persona_id_solicitante=persona_id_solicitante,
                roles_solicitante=roles_solicitante,
            )
        )
        if not autorizado:
            raise PermisosInsuficientes(
                "Solo el titular del pago, su representante, o un "
                "administrador pueden consultarlo"
            )
        if not pago:
            raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")
        return pago

    def _url_entrega_voucher(self, pago: Pago) -> str | None:
        """Traduce `pago.voucher_url` (persistido) a una URL de entrega
        vigente. Se llama SOLO desde los puntos que efectivamente responden
        al cliente HTTP (nunca desde `obtener_pago`, reusado internamente
        por `validar_pago`/`adjuntar_comprobante`/`adjuntar_voucher` sin
        pasar por este chequeo), para que la firma se genere después de que
        la autorización ya pasó, no antes."""
        from app.infraestructura.cloudinary_cliente import resolver_url_entrega
        from app.soporte_transversal.configuracion import settings

        if not pago.voucher_url:
            return None
        # Issue #1072: el voucher en imagen se sube como `raw` (con la
        # extensión en el `public_id`), igual que el PDF -- los dos necesitan
        # el endpoint de descarga porque es el único que vence del lado del
        # servidor. `formato` solo se usa para el PDF, cuya extensión NO está
        # en el `public_id`.
        es_pdf = pago.voucher_formato == "application/pdf"
        return resolver_url_entrega(
            pago.voucher_url,
            resource_type="raw",
            folder=settings.cloudinary_carpeta_vouchers,
            formato="pdf" if es_pdf else None,
        )

    def _url_entrega_comprobante(self, pago: Pago) -> str | None:
        """Mismo criterio que `_url_entrega_voucher`, aplicado al comprobante
        OFICIAL (issue #400, criterio 8): `ComprobantePago.archivo_url`
        persiste un `public_id` (nunca una URL pública, ver su docstring en
        `modelos.py`), así que necesita la misma firma fresca antes de
        salir por HTTP. `comprobante_tareas.py` siempre genera PDF
        (`formato_archivo="pdf"`, `resource_type="raw"` -- nunca imagen, a
        diferencia del voucher que el alumno puede subir en JPEG/PNG)."""
        from app.infraestructura.cloudinary_cliente import resolver_url_entrega
        from app.soporte_transversal.configuracion import settings

        if pago.comprobante is None:
            return None
        return resolver_url_entrega(
            pago.comprobante.archivo_url,
            resource_type="raw",
            folder=settings.cloudinary_carpeta_comprobantes,
            formato="pdf",
        )

    def pago_a_response_dto(self, pago: Pago) -> PagoResponseDTO:
        """Punto único donde un `Pago` ORM se convierte en la respuesta HTTP:
        reemplaza el `voucher_url` persistido (un `public_id`, o una URL
        pública heredada de antes del fix) por una URL de entrega firmada
        fresca, y agrega `comprobante_oficial_url` (issue #400, criterio 8)
        con el mismo criterio. Los routers de lectura (`GET /pagos/{id}`,
        `GET /pagos/persona/{id}`, `PATCH /pagos/{id}/validar`, `POST
        /pagos/{id}/voucher`) deben pasar por acá en vez de devolver el
        `Pago` directo -- devolverlo directo filtraría el `public_id` o la
        URL heredada tal cual, sin firmar."""
        dto = PagoResponseDTO.model_validate(pago)
        return dto.model_copy(update={
            "voucher_url": self._url_entrega_voucher(pago),
            "comprobante_oficial_url": self._url_entrega_comprobante(pago),
        })

    def listar_pagos_de_persona(
        self,
        persona_id_objetivo: int,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> list[Pago]:
        """Historial completo (cualquier estado) de los pagos de una persona,
        para que el propio alumno o su representante puedan ver su historial
        financiero (lectura, sin exponer subida/registro de comprobante --
        eso sigue siendo otro flujo). Misma autorización que `registrar_pago`
        (ver `PoliticaAccesoPersona`)."""
        roles_solicitante = roles_solicitante or []
        if not PoliticaAccesoPersona(self.db).puede_acceder(
            persona_id_objetivo=persona_id_objetivo,
            persona_id_solicitante=persona_id_solicitante,
            roles_solicitante=roles_solicitante,
        ):
            raise PermisosInsuficientes(
                "Solo la propia persona, su representante, o un administrador "
                "pueden ver este historial de pagos"
            )

        return self.repo.listar_por_persona(persona_id_objetivo)

    def listar_coberturas_de_persona(
        self,
        persona_id_objetivo: int,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> list[CoberturaBonificada]:
        """Activaciones de cobertura bonificada de una persona (issue #1369,
        slice 3), para mezclarlas como filas del historial de pagos: el #400
        no creó ningún `Pago`, así que sin esta lectura el mes cubierto por el
        beneficio era invisible. EXACTAMENTE la misma autorización que
        `listar_pagos_de_persona` -- es la misma conversación financiera.
        """
        roles_solicitante = roles_solicitante or []
        if not PoliticaAccesoPersona(self.db).puede_acceder(
            persona_id_objetivo=persona_id_objetivo,
            persona_id_solicitante=persona_id_solicitante,
            roles_solicitante=roles_solicitante,
        ):
            raise PermisosInsuficientes(
                "Solo la propia persona, su representante, o un administrador "
                "pueden ver este historial de pagos"
            )

        return self.repo_cobertura_bonificada.listar_por_persona(
            persona_id_objetivo
        )

    def listar_coberturas(
        self, skip: int = 0, limit: int = 50,
    ) -> tuple[list[CoberturaBonificadaListItemDTO], int]:
        """Revisión del admin (issue #1609): las coberturas 100% no son
        `Pago`, así que no entran en `listar_pagos`; este listado de solo
        lectura las muestra junto a la cola, con monto cero."""
        coberturas = self.repo_cobertura_bonificada.listar(skip=skip, limit=limit)
        total = self.repo_cobertura_bonificada.contar()
        items = []
        for c in coberturas:
            persona = self.repo_persona.obtener_por_id(c.persona_id)
            items.append(CoberturaBonificadaListItemDTO(
                id=c.id,
                persona_id=c.persona_id,
                persona_nombre_completo=nombre_completo(persona.nombres, persona.apellidos),
                membresia_id=c.membresia_id,
                monto=Decimal("0.00"),
                fecha_inicio=c.fecha_inicio,
                fecha_fin=c.fecha_fin,
                otorgada_en=c.otorgada_en,
            ))
        return items, total

    def generar_comprobante_cobertura(
        self,
        cobertura_id: int,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> tuple[bytes, str]:
        """Recibo PDF de una cobertura bonificada (issue #1609), generado al
        pedirlo: sin Cloudinary, sin Celery, sin `ComprobantePago`. Misma
        autorización que el historial (`PoliticaAccesoPersona`): titular, su
        representante o administrador. Devuelve `(bytes, nombre_archivo)`."""
        from app.infraestructura.generador_pdf import generar_comprobante_cobertura_pdf

        roles_solicitante = roles_solicitante or []
        cobertura = self.repo_cobertura_bonificada.obtener_por_id(cobertura_id)
        if cobertura is None:
            raise EntidadNoEncontrada(f"Cobertura bonificada con id {cobertura_id} no encontrada")
        if not PoliticaAccesoPersona(self.db).puede_acceder(
            persona_id_objetivo=cobertura.persona_id,
            persona_id_solicitante=persona_id_solicitante,
            roles_solicitante=roles_solicitante,
        ):
            raise PermisosInsuficientes(
                "Solo la propia persona, su representante, o un administrador "
                "pueden descargar este recibo"
            )
        persona = self.repo_persona.obtener_por_id(cobertura.persona_id)
        membresia = self.repo_membresia.obtener_por_id(cobertura.membresia_id)
        pdf = generar_comprobante_cobertura_pdf(
            cobertura_id=cobertura.id,
            persona_nombre=nombre_completo(persona.nombres, persona.apellidos),
            persona_cedula=persona.cedula,
            persona_telefono=persona.telefono,
            membresia_categoria=membresia.tipo_membresia.categoria,
            monto=Decimal("0.00"),
            fecha_inicio=cobertura.fecha_inicio,
            fecha_fin=cobertura.fecha_fin,
            fecha_otorgamiento=cobertura.otorgada_en,
        )
        return pdf, f"recibo-cobertura-C-{cobertura.id:06d}.pdf"

    def listar_pagos(
        self,
        estado_pago: EstadoPago | None = None,
        skip: int = 0,
        limit: int = 50,
        fecha_inicio: date | None = None,
        fecha_fin: date | None = None,
        operational_only: bool = False,
    ) -> tuple[list[PagoListItemDTO], int]:
        """Cola de validación (Administrador) y reporte de pagos. Construye
        PagoListItemDTO a mano (en vez de from_attributes directo) porque
        `persona_nombre_completo` no es una columna de Pago: se arma a partir
        de la relación cargada (ver joinedload en el repositorio, evita N+1
        queries)."""
        pagos = self.repo.listar(
            estado_pago=estado_pago, skip=skip, limit=limit,
            fecha_inicio=fecha_inicio, fecha_fin=fecha_fin, operational_only=operational_only,
        )
        total = self.repo.contar(
            estado_pago=estado_pago, fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
            operational_only=operational_only,
        )
        items = [
            PagoListItemDTO(
                id=p.id,
                monto=p.monto,
                estado_pago=p.estado_pago,
                tipo_pago=p.tipo_pago,
                fecha_registro=p.fecha_registro,
                fecha_validacion=p.fecha_validacion,
                fecha_inicio=p.fecha_inicio,
                fecha_fin=p.fecha_fin,
                persona_id=p.persona_id,
                persona_nombre_completo=nombre_completo(p.persona.nombres, p.persona.apellidos),
                responsable_pago_nombre_completo=(
                    nombre_completo(p.persona.representante.nombres, p.persona.representante.apellidos)
                    if p.persona.representante is not None else None
                ),
                membresia_id=p.membresia_id,
                voucher_url=self._url_entrega_voucher(p),
                voucher_formato=p.voucher_formato,
            )
            for p in pagos
        ]
        return items, total

    def validar_pago(
        self, pago_id: int, datos: PagoValidarDTO, actor_persona_id: int | None,
    ) -> Pago:
        """
        Regla de negocio:
        - Aprobar un pago activa su membresía (INACTIVA/VENCIDA -> ACTIVA).
        - Rechazar un pago NO reutiliza un estado de Membresia para expresarlo
          (ese es justamente el error que corregimos: el estado de "rechazado"
          es de Pago, no de Membresia). Si la membresía ya estaba ACTIVA por un
          pago previo, rechazar un pago de renovación no debe desactivarla;
          si nunca se había activado, permanece INACTIVA.
        - Aplica E04-RF002 (gratuidad del 4to familiar) al aprobar.
        - Tras aprobar, dispara asincrónicamente la generación del comprobante
          PDF + subida a Cloudinary (vía Celery). El disparo va DESPUÉS del
          commit y su fallo no revierte la aprobación (el dinero ya fue
          validado): la tarea de reconciliación re-despacha lo perdido (ver
          `comprobante_tareas.reconciliar_comprobantes_faltantes`).

        Guardia de estado (auditoría, hallazgo 5): solo un pago
        PENDIENTE_VALIDACION puede validarse. La fila se lee con
        `SELECT ... FOR UPDATE`, así dos validaciones concurrentes del mismo
        pago se serializan: exactamente una gana; la otra relee el estado ya
        commiteado y recibe `OperacionInvalida` (400). Sin esto, revalidar un
        pago reactivaba la membresía, re-aplicaba la gratuidad familiar,
        re-disparaba el PDF y duplicaba la notificación.

        Autoría fail-closed (issue #458): `actor_persona_id` no lleva default
        -- el llamador (el router) SIEMPRE debe pasar explícitamente lo que
        trajo el JWT, aunque sea `None`, para que un futuro call-site nunca
        omita el argumento en silencio y guarde un pago sin autor por
        accidente. Si el JWT decodificado no trae `persona_id` (token
        malformado o legado), la operación se rechaza ACÁ, antes de tocar el
        pago: guardar la aprobación/rechazo sin saber quién la ejecutó es
        justamente el defecto que este issue cierra. 403 (`PermisosInsuficientes`)
        y no 500: no es un bug del servidor, es que no se pudo verificar la
        identidad de quien pide la operación -- mismo código que usa
        `GestorPermisos` cuando el rol no alcanza.

        Excepción auditada sin comprobante (issue #459): aprobar una
        TRANSFERENCIA sin `voucher_url` exige `datos.motivo_excepcion_sin_
        comprobante` no vacío -- antes de este fix, el único gate era el
        checklist de autoatestación del frontend (dos checkboxes sin
        ninguna validación real), así que un pago quedaba aprobado sin
        ninguna evidencia y sin dejar ningún rastro de por qué. Esta
        excepción es DELIBERADAMENTE angosta:
          - Solo se exige al APROBAR, nunca al RECHAZAR -- rechazar no
            activa la membresía ni mueve dinero, no hay nada que auditar.
          - Solo aplica a TRANSFERENCIA. Un EFECTIVO sin comprobante es el
            camino NORMAL (issue #452: el voucher nunca aplicó a pagos en
            efectivo), no una excepción que requiera justificarse.
          - No aplica si el pago YA tiene voucher: ese es el camino de
            siempre (revisar el comprobante adjunto), sin cambios acá.
        """
        if actor_persona_id is None:
            raise PermisosInsuficientes(
                "No se pudo identificar al administrador que aprueba o "
                "rechaza este pago.",
                detalle_tecnico=f"pago_id={pago_id} token sin persona_id",
            )

        pago = self.repo.obtener_por_id_con_bloqueo(pago_id)
        if not pago:
            raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")

        if pago.estado_pago != EstadoPago.PENDIENTE_VALIDACION:
            raise OperacionInvalida(
                "Solo un pago por validar puede aprobarse o "
                f"rechazarse; este pago ya está "
                f"{estado_de_pago_en_castellano(pago.estado_pago)}.",
                detalle_tecnico=f"pago_id={pago_id} estado_pago={pago.estado_pago.value}",
            )

        # Ver docstring: excepción auditada, angosta a propósito (aprobar +
        # TRANSFERENCIA + sin voucher). El chequeo va ACÁ, antes de tocar el
        # pago, para que un motivo faltante lo rechace limpio (400) sin
        # dejar ningún efecto secundario a medias.
        if datos.estado_pago == EstadoPago.APROBADO:
            membresia = self.repo_membresia.obtener_por_id(pago.membresia_id)
            if membresia is None:
                raise EntidadNoEncontrada(f"Membresía con id {pago.membresia_id} no encontrada")
            self._exigir_membresia_financieramente_operativa(membresia)

        requiere_motivo_excepcion = (
            datos.estado_pago == EstadoPago.APROBADO
            and pago.tipo_pago == TipoPago.TRANSFERENCIA
            and not pago.voucher_url
        )
        if requiere_motivo_excepcion and (
            datos.motivo_excepcion_sin_comprobante is None
            or not datos.motivo_excepcion_sin_comprobante.strip()
        ):
            raise OperacionInvalida(
                "Debes indicar el motivo de la excepción para aprobar una "
                "transferencia sin comprobante adjunto.",
                detalle_tecnico=f"pago_id={pago_id} tipo_pago=TRANSFERENCIA voucher_url=None",
            )

        pago.estado_pago = datos.estado_pago
        pago.motivo_rechazo = datos.motivo_rechazo
        pago.fecha_validacion = datetime.now(timezone.utc)
        # Mismo campo para APROBADO y RECHAZADO (issue #458): quién lo validó
        # no depende del desenlace, igual que `fecha_validacion` ya unifica
        # el "cuándo" de las dos ramas de abajo.
        pago.validado_por_persona_id = actor_persona_id
        # Solo se persiste en el caso exacto de la excepción (issue #459):
        # un motivo enviado fuera de ese caso (p. ej. el pago sí tenía
        # voucher) se descarta en silencio, para que la columna signifique
        # siempre lo mismo -- "esta aprobación fue la excepción auditada" --
        # y nunca un dato suelto sin relación con lo que de verdad pasó.
        pago.motivo_excepcion_sin_comprobante = (
            datos.motivo_excepcion_sin_comprobante if requiere_motivo_excepcion else None
        )

        if datos.estado_pago == EstadoPago.APROBADO:
            # `pago.fecha_inicio`/`fecha_fin` NO se tocan acá (issue #400):
            # Administración no puede editar la cobertura al aprobar, así
            # que lo que sigue usando `pago.fecha_inicio` es SIEMPRE lo que
            # `registrar_pago` derivó del monto base y la cuota vigente en
            # el momento del registro -- nunca un valor que el admin haya
            # podido pisar en este paso.
            membresia = pago.membresia
            # Flush pending changes before counting active family memberships.
            # With autoflush=False, the ACTIVA state set above is not visible
            # to subsequent DB queries unless we explicitly flush. The 4th-family
            # gratuity rule (E04-RF002) depends on an accurate count, which
            # includes the membership we just activated. El flush (y su red
            # de seguridad ante `uq_membresia_activa_por_persona`) vive en
            # `_activar_membresia_con_red_de_seguridad`, compartida con
            # `aplicar_beneficio_bonificado` (issue #400/4d) -- ver su
            # docstring.
            self._activar_membresia_con_red_de_seguridad(membresia)
            try:
                self._aplicar_regla_familiar_si_corresponde(membresia, pago)
                self.repo.guardar_cambios(pago)
                # Un solo commit para membresía + pago (issue #831): antes,
                # `repo.guardar_cambios(pago)` comiteaba acá adentro, ya
                # separado del `flush()` de `_activar_membresia_con_red_de_
                # seguridad` -- ahora se confirman juntos.
                self.db.commit()
            except IntegrityError as error:
                self.db.rollback()
                if "uq_membresia_activa_por_persona" in str(error.orig):
                    raise OperacionInvalida(MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA) from error
                raise
            aviso_ok = self._crear_notificacion_pago(
                pago=pago,
                tipo=TipoNotificacion.PAGO_APROBADO,
                mensaje=f"Tu pago de {formatear_monto_usd(pago.monto)} fue aprobado. Tu membresía está activa.",
            )
            self._enviar_correo_de_validacion_pago(pago, TipoNotificacion.PAGO_APROBADO)
            # Último paso, ya con la aprobación commiteada: si el broker está
            # caído, el método loguea y NO propaga (ver su docstring).
            self._disparar_generacion_comprobante_pdf(pago_id)
        else:
            # EstadoPago.RECHAZADO: el estado de Membresia no cambia; el rechazo
            # queda registrado únicamente en Pago.estado_pago y Pago.motivo_rechazo.
            self.repo.guardar_cambios(pago)
            self.db.commit()
            motivo = f": {pago.motivo_rechazo}" if pago.motivo_rechazo else ""
            aviso_ok = self._crear_notificacion_pago(
                pago=pago,
                tipo=TipoNotificacion.PAGO_RECHAZADO,
                mensaje=f"Tu pago fue rechazado{motivo}.",
            )
            self._enviar_correo_de_validacion_pago(pago, TipoNotificacion.PAGO_RECHAZADO)
        # Issue #826/#451 (ver el comentario de `PersonaServicio.
        # crear_representado`): este método corre dentro de
        # `run_in_threadpool` y el router arma la respuesta (`pago_a_
        # response_dto`) DESPUÉS, ya en el event loop. Va ANTES de asignar
        # el atributo transitorio de abajo: `refresh()` solo recarga
        # columnas mapeadas, nunca toca atributos Python sueltos, pero
        # hacerlo en este orden evita cualquier ambigüedad.
        if inspeccionar_orm(pago).expired:
            self.db.refresh(pago)
        # Atributo transitorio, no una columna de `Pago`: `PagoResponseDTO`
        # (from_attributes=True) lo lee por `getattr` para que el 200 que
        # vuelve diga la verdad completa cuando el aviso in-app falló
        # (hallazgo en vivo, 2026-08-11 -- ver docstring de
        # `_crear_notificacion_pago`).
        pago.aviso_no_enviado = not aviso_ok
        return pago

    # --- Activación compartida (issue #400/4d) -------------------------------
    def _activar_membresia_con_red_de_seguridad(self, membresia: Membresia) -> None:
        """Activa la membresía (INACTIVA/VENCIDA -> ACTIVA) y hace el
        `flush()` que la vuelve visible a consultas posteriores en esta
        misma transacción.

        Compartido por `validar_pago` (aprobar un pago),
        `aplicar_beneficio_bonificado` (otorgar cobertura 100% bonificada)
        y `regularizar_deuda` (solo cuando el período cubre hoy, issue
        #1492): los tres caminos hacen que la persona reciba
        cobertura REAL, así que los tres deben dejar la membresía ACTIVA.

        Issue #1225: `fecha_activacion` SOLO se escribe cuando la membresía
        todavía está INACTIVA al entrar acá -- la primera activación real.
        "Socio desde" lee esta columna (`frontend/src/app/student/page.tsx`),
        y esa antigüedad es la PRIMERA vez que la persona tuvo cobertura,
        nunca la renovación más reciente: una membresía ya ACTIVA, VENCIDA o
        SUSPENDIDA conserva la que ya tenía. Antes se pisaba en cada pago
        aprobado (aunque el docstring ya describía la transición INACTIVA/
        VENCIDA -> ACTIVA); un segundo pago sobre una membresía ya ACTIVA
        corría la misma línea y adelantaba la antigüedad del socio a la
        fecha de la renovación (hallazgo en vivo, QA 2026-09-15, persona 91,
        membresía 68).

        Issue #1212: cuando SÍ corresponde escribirla, es el instante real
        de la activación, no medianoche UTC del `fecha_inicio` del pago
        (esa medianoche cae en el día calendario ANTERIOR para cualquier
        browser UTC-negativo). `datetime.now(timezone.utc)` es un instante
        genuino -- igual que la creación INACTIVA (ver más arriba) -- y
        ningún llamador depende de que sea la fecha calendario de `fecha_
        inicio`: el único otro lector, `MembresiaRepositorio.listar`
        (`membresia_repositorio.py`), solo la usa para el `ORDER BY ... DESC`
        de "más reciente primero", al que le sirve cualquier instante real.

        Red de seguridad del invariante 2 (issue #8): dos escrituras
        concurrentes de ACTIVA para la misma persona (dos pagos, o un pago y
        un otorgamiento, aprobándose a la vez) las serializa el índice
        `uq_membresia_activa_por_persona`; el `IntegrityError` se traduce acá
        al MISMO error de dominio para ambos llamadores, así ninguno de los
        dos tiene que saber del índice. El `rollback()` es obligatorio: un
        flush fallido deja la sesión inválida para cualquier uso posterior."""
        if membresia.estado == EstadoMembresia.INACTIVA:
            membresia.fecha_activacion = datetime.now(timezone.utc)
        membresia.estado = EstadoMembresia.ACTIVA
        try:
            self.db.flush()
        except IntegrityError as error:
            self.db.rollback()
            if "uq_membresia_activa_por_persona" in str(error.orig):
                raise OperacionInvalida(MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA) from error
            raise

    # --- E04-RF002: gratuidad del 4to miembro -------------------------------
    def _aplicar_regla_familiar_si_corresponde(self, membresia: Membresia, pago: Pago) -> None:
        """
        Si la persona representada (alumno) tiene un representante, y ese
        representante ya tiene 3 membresías activas en el mismo periodo (solapa
        la fecha_fin de este pago), entonces este pago activa la gratuidad:
        `es_gratuidad_familiar` pasa a `True`.

        La propia membresía que acabamos de activar queda incluida en el conteo
        (ya está ACTIVA y solapa), de modo que si el total familiar llega a 4
        (es el 4to miembro) aplicamos gratuidad a ESTA membresía en concreto.
        Solo aplica a personas con representante; una persona sin representante
        no entra en la regla familiar.

        Issue #400 (slice 4c-b): `monto_aplicado` YA NO se lleva a cero acá.
        La membresía conserva su tarifa real, resuelta server-side del
        catálogo (`crear_membresia`) -- es el hecho de "cuánto vale este
        plan", y sigue siéndolo aunque esta familia no lo pague. La bandera
        es ahora la ÚNICA señal autorizada de "no paga" (ver
        `registrar_pago`, que gatea el cobro por la bandera y NUNCA por
        `precio_mensual == 0`): zerear el precio acá rompía esa separación,
        porque un precio en cero deja de significar "sin tarifa" y empieza a
        significar "gratis", que son hechos distintos y ninguno debe
        inferirse del otro (ver `scripts/inventario_anomalias_membresias.py`,
        A2).

        Fix (hallazgo del revisor, reproducido contra Postgres real): el
        `pago` recibido acá es el MISMO que se está aprobando -- si es el que
        recién cruza el umbral (el 4to miembro), `registrar_pago` lo congeló
        ANTES, cuando la bandera todavía era `False`, así que su `monto` es
        la tarifa real completa. Sin este fix, ese pago -- justo el que le
        DA la gratuidad a la familia -- era el único que la cobraba en vez de
        respetarla; `registrar_pago` nunca vuelve a tocarlo después de
        aprobado, así que nada más lo corregía. La corrección es zerear
        `pago.monto` ACÁ, sin condición extra ("recién aplica" vs. "ya
        aplicaba"): esta función corre en CADA aprobación de una familia con
        4+ miembros activos, y el pago que se está aprobando SIEMPRE
        pertenece a esa familia y a ese período -- no hay ningún caso donde
        deba cobrarse. Para una renovación (bandera ya `True` desde antes),
        `registrar_pago` ya lo había registrado en $0 (ver el gate de más
        arriba), así que volver a asignar `Decimal("0.00")` acá es un no-op;
        no hace falta distinguir "recién aplica" de "ya aplicaba" para que el
        resultado sea correcto en los dos casos.

        Cualquier descuento personal que `_congelar_beneficio_activo` ya
        hubiera congelado en ESTE pago (posible SOLO en el caso que recién
        cruza el umbral: al registrarse, la bandera todavía era `False`, así
        que `registrar_pago` sí pasó por esa función) queda ANULADO acá, no
        conservado como registro histórico. Motivo: a diferencia de la beca
        del 100% de `_congelar_beneficio_activo` (`monto_base - valor_
        aplicado == 0`, donde las columnas de descuento SÍ se conservan
        porque son la explicación completa y suficiente del cero), acá el
        cero lo explica la gratuidad familiar, no el descuento -- dejar
        `descuento_valor_aplicado` con un monto positivo junto a `monto =
        0.00` describiría un beneficio que en los hechos nunca se aplicó (la
        familia no pagó nada por él, y `AsignacionDescuento` -- la concesión
        del beneficio en sí -- no se toca, así que la persona lo conserva
        para su próximo pago no gratuito). Conservar esas columnas
        "por las dudas" inventaría un hecho contable que no ocurrió, el
        mismo error que este slice completo existe para eliminar.
        """
        persona = self.repo_persona.obtener_por_id(membresia.persona_id)
        if not persona or not persona.representante_id:
            return None

        en_fecha = pago.fecha_fin
        activas_familia = self.repo_membresia.contar_membresias_activas_familia(
            persona.representante_id, en_fecha
        )

        if activas_familia >= FAMILIA_UMBRAL_GRATUIDAD + 1:
            membresia.es_gratuidad_familiar = True
            pago.monto = Decimal("0.00")
            pago.descuento_id = None
            pago.descuento_valor_aplicado = None
            pago.descuento_porcentaje_aplicado = None
            pago.descuento_autorizado_por_persona_id = None
        return None

    def _crear_notificacion_pago(self, pago: Pago, tipo: TipoNotificacion, mensaje: str) -> bool:
        """Envoltorio delgado de `_crear_notificacion` para los dos avisos de
        `validar_pago` (aprobado/rechazado): conserva la firma original
        (`pago`, no `persona_id`/`entidad_relacionada_id` sueltos) para no
        tocar sus dos call sites. Ver `_crear_notificacion` para el
        comportamiento completo (nunca levanta, log + rollback local)."""
        return self._crear_notificacion(
            persona_id=pago.persona_id,
            entidad_relacionada_id=pago.id,
            tipo=tipo,
            mensaje=mensaje,
            id_para_log=f"pago {pago.id}",
        )

    def _responsable_del_correo_de_pago(self, persona: Persona) -> Optional[Persona]:
        """Cuenta que recibe el aviso de un pago: la de la persona, o la de su
        representante cuando la persona no tiene cuenta propia.

        Un menor representado NUNCA tiene `Usuario` (issue #1137, invariante
        B, con candado de base): hasta acá eso significaba quedarse sin
        correo. La resolución del titular es la misma que ya usa
        `alertas_tareas._responsable_de_pago` -- el representante manda si
        `persona.representante_id` está seteado -- con un requisito extra:
        ese representante tiene que TENER cuenta con correo. Devuelve `None`
        cuando no hay ninguna cuenta alcanzable; el llamador loguea y omite,
        nunca inventa una dirección."""
        if persona.usuario is not None:
            return persona
        representante = persona.representante if persona.representante_id else None
        if representante is not None and representante.usuario is not None:
            return representante
        return None

    def _enviar_correo_de_validacion_pago(
        self, pago: Pago, tipo: TipoNotificacion, regularizacion: bool = False,
    ) -> None:
        """Correo al titular por la aprobación o el rechazo de su pago.

        Best-effort y NUNCA levanta: cuando esto corre, la validación ya está
        commiteada (mismo criterio que `_crear_notificacion`) y un correo
        fallido no puede convertir en 5xx una operación que en los hechos sí
        se procesó. Se llama desde el mismo punto donde nace el aviso
        in-app, para que la campana y el correo no se separen.

        El destinatario es la cuenta de la propia persona
        (`persona.usuario.correo`). Si no tiene -- típicamente un menor
        representado -- el aviso va a la cuenta de su representante
        (`_responsable_del_correo_de_pago`) y el cuerpo nombra al alumno para
        que se entienda de quién es el pago. Solo si NINGUNA de las dos
        cuentas es alcanzable se omite el correo y se loguea: nunca se
        inventa una dirección.

        Ni el log ni el detalle de la excepción escriben el correo completo
        (issue #1066): el mensaje de `ServicioNoDisponible` trae el
        destinatario en su texto, así que solo se registra el tipo."""
        persona = self.repo_persona.obtener_por_id(pago.persona_id)
        destinatario = (
            self._responsable_del_correo_de_pago(persona) if persona is not None else None
        )
        if destinatario is None:
            logger.warning(
                "Correo de %s omitido: persona_id=%s no tiene cuenta con correo "
                "ni representante alcanzable",
                tipo.value, pago.persona_id,
            )
            return
        # Solo cuando el aviso va a OTRA persona el cuerpo nombra al alumno;
        # si el destinatario es el propio alumno, el texto de siempre queda
        # correcto y no cambia.
        nombre_alumno = (
            nombre_completo(persona.nombres, persona.apellidos)
            if destinatario.id != persona.id
            else None
        )
        try:
            servicio = ServicioNotificaciones()
            if regularizacion:
                enviar_deuda_regularizada(
                    servicio,
                    correo=destinatario.usuario.correo,
                    nombre=destinatario.nombres,
                    monto=pago.monto,
                    vigente_hasta=(
                        self._fecha_fin_maxima_combinada(pago.membresia_id) or pago.fecha_fin
                    ),
                    nombre_alumno=nombre_alumno,
                )
            elif tipo == TipoNotificacion.PAGO_APROBADO:
                servicio.enviar_pago_aprobado(
                    correo=destinatario.usuario.correo,
                    nombre=destinatario.nombres,
                    nombre_alumno=nombre_alumno,
                    monto=pago.monto,
                    plan=pago.membresia.tipo_membresia.categoria,
                    fecha_inicio=pago.fecha_inicio,
                    fecha_fin=pago.fecha_fin,
                    # La cobertura vigente es la más lejana de la membresía,
                    # no la de este pago: aprobar un pago viejo después de
                    # uno nuevo no debe acortar lo que el correo declara
                    # (misma ancla que "vigente hasta" en el portal).
                    vigente_hasta=(
                        self._fecha_fin_maxima_combinada(pago.membresia_id) or pago.fecha_fin
                    ),
                )
            else:
                servicio.enviar_pago_rechazado(
                    correo=destinatario.usuario.correo,
                    nombre=destinatario.nombres,
                    motivo_rechazo=pago.motivo_rechazo,
                    nombre_alumno=nombre_alumno,
                    monto=pago.monto,
                    fecha_inicio=pago.fecha_inicio,
                    fecha_fin=pago.fecha_fin,
                    alumno_id=persona.id,
                )
        except (RuntimeError, ServicioNoDisponible) as exc:
            logger.warning(
                "Correo de %s no enviado a persona_id=%s: %s",
                tipo.value, pago.persona_id, type(exc).__name__,
            )

    def _notificar_admins_cobertura(
        self, cobertura: CoberturaBonificada, membresia: Membresia,
    ) -> None:
        """Aviso operativo a cada administrador con cuenta activa por la
        activación recién commiteada (issue #1369, slice 2). Complementa el
        aviso del titular (`COBERTURA_BONIFICADA_OTORGADA`): un admin que no
        es el titular ni su representante hoy se entera sólo si abre la
        membresía a mano.

        Igual que `_crear_notificacion` (mismo criterio del #400/4d y de los
        avisos de pago): corre DESPUÉS del commit de la operación principal,
        con try/except + rollback propio -- un fallo del aviso nunca convierte
        en 5xx una activación que en los hechos SÍ se procesó, y el rollback
        deja la sesión usable para serializar la respuesta.

        Los admins salen de `RolRepositorio.obtener_por_tipo_con_usuarios`
        (una sola consulta con `joinedload`, issue #810), igual que
        `enrollment_servicio._notificar_nueva_inscripcion`. El admin que es a
        la vez titular NO recibe la segunda fila: su aviso de titular ya le
        avisó de esta misma cobertura (mismo criterio anti-duplicado que el
        #1227).
        """
        try:
            rol_admin = self.repo_rol.obtener_por_tipo_con_usuarios(
                TipoRol.ADMINISTRADOR
            )
            if not rol_admin:
                return
            titular = membresia.persona
            nombre_titular = acortar_nombre_para_notificacion(
                nombre_completo(titular.nombres, titular.apellidos)
                if titular else f"persona {membresia.persona_id}"
            )
            mensaje = (
                f"Cobertura bonificada (100%) activada para {nombre_titular}: "
                f"1 mes (del {cobertura.fecha_inicio.isoformat()} al "
                f"{cobertura.fecha_fin.isoformat()})."
            )
            for admin in (
                u.persona for u in rol_admin.usuarios if u.persona and u.activo
            ):
                if admin.id == membresia.persona_id:
                    continue
                self._crear_notificacion(
                    persona_id=admin.id,
                    entidad_relacionada_id=cobertura.id,
                    tipo=TipoNotificacion.COBERTURA_BONIFICADA_ADMIN,
                    mensaje=mensaje,
                    id_para_log=(
                        f"cobertura bonificada {cobertura.id} (admin "
                        f"{admin.id})"
                    ),
                )
        except Exception:
            # `rollback()` deshace SOLO la transacción parcial de estos
            # avisos; la cobertura y la membresía ya están commiteadas.
            self.db.rollback()
            logger.exception(
                "No se pudo notificar a los administradores de la cobertura "
                "bonificada %s. La activación YA está commiteada.",
                cobertura.id,
            )

    def _crear_notificacion(
        self, persona_id: int, entidad_relacionada_id: int,
        tipo: TipoNotificacion, mensaje: str, id_para_log: str,
    ) -> bool:
        """Crea el aviso in-app para el titular. Devuelve `False` (y NUNCA
        levanta) si no se pudo crear -- nunca `True`/`False` a medias
        silenciado. Compartida por `_crear_notificacion_pago` (aprobar/
        rechazar un pago) y `aplicar_beneficio_bonificado` (issue #400/4d,
        otorgar cobertura bonificada): las dos operaciones YA están
        commiteadas cuando esto corre, así que un aviso fallido nunca debe
        convertirse en un 5xx sobre una operación que en los hechos SÍ se
        procesó.

        Ya NO escribe una segunda fila para `persona.representante_id`
        (issue #1227): desde el #859 el feed del representante
        (`NotificacionServicio.listar_para_persona_y_hijos`) YA incluye las
        filas de sus dependientes activos, así que esa segunda fila era el
        duplicado que veía el representante -- la misma novedad dos veces,
        una con el prefijo "Para <nombre>: " y otra sin él. El prefijo se
        arma ahora AL LEER, en `NotificacionServicio`, para cualquier fila
        cuyo `persona_id` no sea el de quien pide el feed.

        Por qué no relanza: por diseño del frontend (`error-message.ts`: un
        `detail` 5xx nunca llega al usuario, porque describe una falla del
        SERVIDOR, no algo que el usuario deba leer) quien llama vería el
        cartel genérico "El servidor no pudo completar la operación" sobre
        una operación que en realidad SÍ se procesó. Cada llamador lee este
        `bool` y lo expone en su propio DTO de respuesta (ver `PagoResponseDTO.
        aviso_no_enviado`), así el 200 que ya vuelve lleva la verdad completa
        en vez de tener que elegir entre mentir con un 200 mudo o mentir con
        un 500 falso (hallazgo en vivo, 2026-08-11: antes de este fix era ni
        siquiera esto -- un `DataError` sin capturar por VARCHAR(255) en
        `notificacion.mensaje`, con la operación ya commiteada)."""
        persona = self.repo_persona.obtener_por_id(persona_id)
        if not persona:
            return True  # nada que notificar no es un fallo
        try:
            notif = Notificacion(
                tipo=tipo,
                mensaje=mensaje,
                persona_id=persona.id,
                entidad_relacionada_id=entidad_relacionada_id,
            )
            self.repo_notificacion.crear(notif)
            # Commit PROPIO (issue #831): el repositorio ya solo flushea, así
            # que esta notificación necesita su propio `commit()` para
            # persistir -- deliberadamente SEPARADO del commit de la
            # operación principal (aprobar/rechazar un pago, otorgar
            # cobertura), que ya corrió antes de llegar acá. Ver el docstring
            # de arriba: un aviso fallido nunca debe poder tirar para atrás
            # una operación que ya se procesó.
            self.db.commit()
            return True
        except Exception:
            # `rollback()` deshace SOLO la transacción de esta notificación
            # (nunca llegó a `commit`): lo que ya se commiteó antes sigue
            # intacto. Necesario para que la sesión quede usable después de
            # un `DataError` -- sin esto, cualquier lectura posterior (ej.
            # serializar la respuesta) tira `PendingRollbackError` encima del
            # problema original.
            self.db.rollback()
            logger.exception(
                "No se pudo crear la notificación de %s (persona_id=%s). "
                "La operación YA está commiteada.",
                id_para_log, persona_id,
            )
            return False

    def adjuntar_comprobante(self, pago_id: int, datos: ComprobantePagoCreateDTO) -> ComprobantePago:
        pago = self.obtener_pago(pago_id)
        if pago.estado_pago != EstadoPago.APROBADO:
            raise OperacionInvalida(
                "Solo se puede adjuntar el recibo a un pago aprobado."
            )
        if pago.comprobante:
            raise OperacionInvalida("Este pago ya tiene un recibo adjunto")
        comprobante = ComprobantePago(**datos.model_dump(), pago_id=pago_id)
        resultado = self.repo_comprobante.crear(comprobante)
        self.db.commit()
        if inspeccionar_orm(resultado).expired:
            self.db.refresh(resultado)
        return resultado

    # --- Voucher de transferencia (cliente) -----------------------------------
    def adjuntar_voucher(
        self,
        pago_id: int,
        persona_id_solicitante: int | None,
        roles_solicitante: list[str],
        contenido: bytes,
        content_type: str | None,
        nombre_archivo: str | None,
    ) -> Pago:
        """
        Adjunta (o sobrescribe) el voucher de transferencia que sube el cliente
        mientras el pago está PENDIENTE_VALIDACION. Distinto de ComprobantePago:
        ese es el PDF OFICIAL generado por el sistema al aprobar un pago
        (tarea Celery), este es la evidencia que adjunta el usuario final.

        Orden de validaciones (cada fallo lanza una excepción de dominio que
        main.py traduce al HTTP correspondiente):
          1. Autorización: dueño del pago, su representante, o admin (403
             PermisosInsuficientes) -- PRIMERO, y de forma indistinguible
             entre "el pago no existe" y "el pago existe pero no es mío"
             (issue #457): para quien no tiene ningún vínculo, ambos casos
             dan el mismo 403 con el mismo mensaje.
          2. El pago existe (404 EntidadNoEncontrada) -- recién acá, ya
             autorizado.
          3. Pago está PENDIENTE_VALIDACION (400 OperacionInvalida) -- ídem:
             el estado real de un pago ajeno tampoco se revela antes de la
             autorización.
          4. content_type permitido JPG/PNG/PDF (400 OperacionInvalida)
          4a. el archivo no está vacío (400 OperacionInvalida) -- issue #462,
              mensaje propio distinto del de firma no coincidente
          4b. la firma binaria real coincide con el tipo declarado (400
              OperacionInvalida) -- REQ-SEC-3, sdd/production-readiness
          5. tamaño <= 5 MB (400 OperacionInvalida)
          6. Subida a Cloudinary (carpeta vouchers), SIN transacción abierta.
          7. Transacción corta que revalida estado y persiste el public_id.

        Los pasos 6 y 7 están separados por el issue #813: antes la subida
        corría dentro de la MISMA transacción que abrió la lectura del paso
        1, así que una conexión del pool quedaba tomada durante toda la
        transferencia. Ver el comentario extenso en el cuerpo.

        La AUTORIZACIÓN se comprueba antes de la subida y NO se vuelve a
        comprobar después: la relectura del paso 7 mira estado y existencia,
        no vínculo ni edad. No hay escalada de privilegio alcanzable
        (`pago.persona_id` no tiene camino de mutación en la app y la minoría
        solo se relaja con el tiempo); el único caso vivo es que un
        administrador desvincule al representante durante la ventana, y
        entonces la evidencia que ese ex-representante ya había elegido
        termina adjunta a un pago para el que SÍ estaba autorizado cuando
        pidió subirla.

        Se permite SOBREESCRIBIR un voucher ya existente mientras el pago siga
        PENDIENTE_VALIDACION (el cliente puede corregir una subida errónea).
        """
        # 1. Autorización: dueño del pago, su representante, o admin. Lee el
        # pago (puede no existir) SOLO para resolver el vínculo -- la lectura
        # interna está bien, lo que no puede pasar es que el pago inexistente
        # se distinga de uno ajeno en la respuesta.
        pago = self.repo.obtener_por_id(pago_id)
        es_admin = "ADMINISTRADOR" in roles_solicitante
        autorizado = es_admin or (
            pago is not None
            and PoliticaAccesoPersona(self.db).puede_acceder(
                persona_id_objetivo=pago.persona_id,
                persona_id_solicitante=persona_id_solicitante,
                roles_solicitante=roles_solicitante,
            )
        )
        if not autorizado:
            raise PermisosInsuficientes(
                "Solo el titular del pago, su representante, o un administrador "
                "pueden adjuntar el comprobante"
            )

        # 2. Pago existe (lanza EntidadNoEncontrada si no) -- ya autorizado.
        if not pago:
            raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")

        # 3. Estado válido para adjuntar voucher.
        if pago.estado_pago != EstadoPago.PENDIENTE_VALIDACION:
            raise OperacionInvalida(
                "Solo se puede adjuntar el comprobante a un pago por validar"
            )

        # E01-RF006/RF007: mismo criterio de solo-lectura financiera para
        # menores que en registrar_pago (ver docstring allá). `pago` ya está
        # garantizado no-None acá (el check #2 de arriba lo asegura).
        es_duenio = persona_id_solicitante is not None and persona_id_solicitante == pago.persona_id
        if es_duenio and not es_admin:
            edad = _calcular_edad(pago.persona.fecha_nacimiento)
            if edad < 18:
                raise PermisosInsuficientes(
                    "Los jugadores menores de edad tienen acceso de solo lectura "
                    "al módulo financiero; un representante o el Administrador "
                    "deben adjuntar este comprobante"
                )

        # 4. Tipo MIME permitido.
        if not content_type or content_type not in TIPOS_MIME_PERMITIDOS_VOUCHER:
            raise OperacionInvalida("Formato de archivo no permitido. Usa JPG, PNG o PDF")

        # 4a. Un archivo de 0 bytes no tiene ninguna firma binaria que
        # coincida con NINGÚN tipo MIME soportado -- sin este check caía en
        # el mensaje de "no coincide con el formato declarado" de 4b, que
        # induce a pensar que se subió el TIPO de archivo equivocado cuando
        # el problema real es que el archivo no tiene contenido (issue #462).
        if not contenido:
            raise OperacionInvalida("El archivo está vacío")

        # 4b. La firma binaria real debe coincidir con el tipo declarado: el
        # Content-Type que manda el cliente no prueba nada sobre el
        # contenido real (decisión de diseño 2.3, sdd/production-readiness).
        if not es_firma_valida(contenido, content_type):
            raise OperacionInvalida(
                "El contenido del archivo no coincide con el formato declarado"
            )

        # 4c. La firma solo mira la cabecera: un archivo corrupto o cortado
        # con cabecera válida la pasa. Se decodifica de verdad (FAM-03).
        if not es_contenido_legible(contenido, content_type):
            raise OperacionInvalida(
                "El archivo está dañado o no se puede leer. Genera el comprobante de nuevo e intenta otra vez."
            )

        # 5. Tamaño máximo. Defensa en profundidad: el router ya acota la
        # lectura vía `leer_con_limite` antes de llegar acá, pero este
        # chequeo protege a cualquier otro llamador futuro de este método
        # que no pase por esa ruta.
        if len(contenido) > TAMANO_MAXIMO_VOUCHER_BYTES:
            raise OperacionInvalida("El archivo pesa más de 5 MB. Elige uno más liviano.")

        # 6. Subida a Cloudinary, con la transacción ya SOLTADA (issue #813).
        #
        # Hasta acá esta petición solo leyó, pero esa lectura ya dejó tomada
        # una conexión del pool: `SessionLocal` es `autocommit=False`, así
        # que el primer acceso ORM abre la transacción y la sostiene hasta el
        # commit. Sostenerla también durante la subida -- hasta 5 MB, acotada
        # en `TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS` -- significa que 30 subidas
        # concurrentes (`pool_size=10` + `max_overflow=20`, un solo proceso
        # de uvicorn) vacían el pool del backend ENTERO, y la espera se
        # propaga a endpoints que no tienen nada que ver con vouchers.
        #
        # `rollback()` devuelve la conexión al pool. No hay nada escrito que
        # perder, y las seis validaciones de arriba YA corrieron: soltar la
        # transacción no relaja ni adelanta ningún chequeo. Es la misma forma
        # que `alertas_tareas.py::_disparar_notificacion_vencimiento` (leer y
        # deduplicar, soltar, hacer la E/S lenta, y recién entonces una
        # transacción corta que commitea).
        #
        # `public_id` se calcula ANTES a propósito, igual que todo lo que se
        # necesita después: `rollback()` EXPIRA cada objeto ORM de la sesión,
        # así que leer un atributo de `pago` a partir de esta línea
        # dispararía un SELECT de refresco -- o un `ObjectDeletedError` si la
        # fila ya no está. Los únicos datos que cruzan el corte son
        # primitivos (`pago_id`, `public_id`, `contenido`, `content_type`).
        #
        # PRECONDICIÓN DEL MÉTODO: la sesión que recibe no puede traer
        # escrituras sin commitear. `self.db` es la sesión de la REQUEST
        # (`Depends(obtener_sesion)`) y este `rollback()` descarta TODO lo que
        # esa sesión haya escrito antes de entrar acá, no solo lo de este
        # método. Hoy se cumple porque nadie compone nada: la única otra
        # dependencia de esta ruta que toca la base es
        # `GestorAutenticacion.decodificar_token` (`app/seguridad/
        # gestor_auth.py`), que solo lee. Para un llamador futuro que escriba
        # ANTES de llamar acá sería destructivo y SILENCIOSO: no falla, pierde
        # la escritura. Ese es exactamente el motivo por el que
        # `alertas_tareas.py` abre su propio `SessionLocal()` en vez de meter
        # mano en la transacción de un llamador -- si este método alguna vez
        # necesita componerse con una escritura previa, la salida es esa, no
        # correr de lugar el `rollback()`.
        from app.infraestructura.cloudinary_cliente import (
            public_id_con_extension,
            subir_voucher_pago,
        )

        # Issue #1072: el `public_id` REAL de un voucher en IMAGEN lleva la
        # extensión (`...jpg`/`...png`) porque se sube como `raw` y la entrega
        # va por el endpoint de descarga (ver `public_id_con_extension` y
        # `_url_descarga_api` en `cloudinary_cliente.py`). Es ESTE valor el
        # que hay que persistir: el que se sube y el que se firma después
        # tienen que ser el mismo (issue #480). El PDF no la lleva: su
        # extensión la agrega `subir_pdf_membresia`/`_url_descarga_api` vía
        # `format="pdf"`.
        public_id = f"voucher-pago-{pago_id:08d}-v1-{uuid4().hex}"
        if content_type != "application/pdf":
            public_id = public_id_con_extension(public_id, content_type)
        self.db.rollback()

        subir_voucher_pago(
            contenido=contenido,
            nombre_publico=public_id,
            content_type=content_type,
            pago_id=pago_id,
        )

        # 7. Transacción CORTA de escritura.
        #
        # La fila se RELEE en vez de reusar el objeto expirado: entre el paso
        # 1 y este punto pasaron hasta 8 s, tiempo de sobra para que un
        # administrador valide el pago. Ese es el desenlace REAL de la ventana.
        # La rama del 404 es defensiva contra un camino que HOY NO EXISTE: no
        # hay ruta DELETE en `membresias_pagos_router.py`, `Pago` no figura en
        # `eliminacion_segura.py` y el repositorio no expone ningún borrado
        # (el test que la ejercita fabrica el borrado con SQL crudo). Se
        # mantiene igual porque si alguna vez aparece ese camino, sin la rama
        # el fallo sería un `ObjectDeletedError` crudo (500) en vez del 404
        # que este método ya documenta. Los dos desenlaces responden
        # exactamente lo mismo que ya respondían los chequeos #2 y #3 (404 y
        # 400, mismos mensajes); lo único nuevo es la ventana, no la respuesta.
        #
        # Every candidate is immutable and uploaded with overwrite=False. A
        # rejected recheck can therefore delete only that candidate safely. An
        # uncertain commit or post-commit verification leaves it orphaned rather
        # than risking evidence already referenced by the payment.
        pago = self.db.query(Pago).filter(Pago.id == pago_id).with_for_update().one_or_none()
        if not pago:
            self.db.rollback()
            self._limpiar_voucher_huerfano(public_id, content_type)
            raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")
        if pago.estado_pago != EstadoPago.PENDIENTE_VALIDACION:
            self.db.rollback()
            self._limpiar_voucher_huerfano(public_id, content_type)
            raise OperacionInvalida(
                "Solo se puede adjuntar el comprobante a un pago por validar"
            )

        voucher_anterior = pago.voucher_url
        formato_anterior = pago.voucher_formato
        pago.voucher_url = public_id
        pago.voucher_formato = content_type
        pago.voucher_fecha_carga = datetime.now(timezone.utc)
        try:
            self.db.commit()
            self.db.refresh(pago)
        except Exception:
            # A failed commit or refresh is ambiguous: preserve the candidate.
            self.db.rollback()
            raise

        # Cache the only lazy relationship the response reads, then detach the
        # confirmed result before releasing the verification transaction.
        _ = pago.comprobante
        self.db.expunge(pago)
        borrar_anterior = False
        try:
            # El guard NO filtra por `formato_anterior` (issue #1072): la
            # columna `voucher_formato` puede venir NULL o atípica (VARCHAR(20)
            # y filas que nunca pasaron por el `content_type` validado), y
            # exigir un MIME de la allowlist salteaba el borrado en silencio
            # -- el comprobante bancario viejo, dato del socio, quedaba vivo
            # en el proveedor sin fallar y sin avisar. Lo que decide QUÉ se
            # borra y CÓMO es `resource_type_de_destruccion` (forma del
            # `public_id` + formato PDF); acá solo se descartan los casos en
            # los que no hay `public_id` que destruir: una URL pública
            # heredada (issue #553) y el candidato recién persistido.
            if (
                voucher_anterior
                and not voucher_anterior.startswith("http")
                and voucher_anterior != public_id
            ):
                vigente = self.db.query(Pago).filter(Pago.id == pago_id).populate_existing().one_or_none()
                borrar_anterior = vigente is not None and vigente.voucher_url != voucher_anterior
        except Exception:
            # A post-commit read that cannot be confirmed leaves an orphan.
            borrar_anterior = False
        finally:
            self.db.rollback()
        if borrar_anterior:
            self._limpiar_voucher_huerfano(voucher_anterior, formato_anterior)
        return pago

    def _limpiar_voucher_huerfano(self, public_id: str, content_type: Optional[str]) -> None:
        """Best effort only: cleanup failures must not discard payment evidence.

        `content_type` puede ser NULL/atípico: viaja tal cual a
        `eliminar_voucher_pago`, que resuelve el `resource_type` por la forma
        del `public_id` (issue #1072)."""
        from app.infraestructura.cloudinary_cliente import eliminar_voucher_pago

        try:
            eliminar_voucher_pago(nombre_publico=public_id, content_type=content_type)
        except Exception:
            logger.warning("No se pudo limpiar un voucher huérfano (public_id=%s)", public_id)

    # --- Disparo asíncrono del comprobante PDF -------------------------------
    def _disparar_generacion_comprobante_pdf(self, pago_id: int) -> None:
        """
        Encola la tarea Celery que genera el PDF del comprobante aprobado y lo
        sube a Cloudinary. Import diferido para evitar dependencia circular
        (celery_app importa tareas, tareas importan configuración, no servicios).

        Un fallo al encolar (Redis caído) NO se propaga: la aprobación ya
        está commiteada y es legítima -- fallar la petición aquí dejaría al
        admin reintentando una validación que ya ocurrió. Se loguea con
        severidad alta y la tarea beat `reconciliar_comprobantes_faltantes`
        re-despacha la generación del comprobante perdido.
        """
        from app.infraestructura.tareas.comprobante_tareas import generar_comprobante_pdf_tarea

        try:
            generar_comprobante_pdf_tarea.delay(pago_id)
        except Exception:
            logger.exception(
                "No se pudo encolar la generación del comprobante del pago %s "
                "(¿broker caído?). La aprobación ya está commiteada; la tarea "
                "de reconciliación lo re-despachará.",
                pago_id,
            )
