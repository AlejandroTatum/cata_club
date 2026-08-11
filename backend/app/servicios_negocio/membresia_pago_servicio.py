import calendar
import logging
from dataclasses import dataclass
from datetime import datetime, date, timezone
from decimal import Decimal
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.modelos import (
    Membresia, TipoMembresia, Pago, ComprobantePago, Notificacion,
)
from app.dominio.enums import EstadoPago, EstadoMembresia, TipoNotificacion, TipoPago
from app.dominio.etiquetas import estado_de_pago_en_castellano
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida, PermisosInsuficientes
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio, TipoMembresiaRepositorio
from app.infraestructura.repositorios.pago_repositorio import PagoRepositorio, ComprobantePagoRepositorio
from app.infraestructura.repositorios.descuento_repositorio import DescuentoRepositorio
from app.infraestructura.repositorios.notificacion_repositorio import NotificacionRepositorio
from app.servicios_negocio.persona_servicio import _calcular_edad
from app.servicios_negocio.politica_acceso import PoliticaAccesoPersona
from app.soporte_transversal.firma_archivos import es_firma_valida
from app.soporte_transversal.tiempo import hoy_club
from app.presentacion.schemas.membresia_pago_schemas import (
    TipoMembresiaCreateDTO, MembresiaCreateDTO, PagoCreateDTO, PagoValidarDTO, ComprobantePagoCreateDTO,
    PagoListItemDTO, PagoResponseDTO,
)


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


# --- Regla Familiar E04-RF002 -----------------------------------------------
# Si una familia (mismos representados bajo el mismo representante_id) ya
# tiene 3 membresías ACTIVAS en el mismo periodo, el 4to miembro recibe
# gratuidad automática: su `monto_aplicado` se lleva a 0.
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
    "Esta membresía ya tiene un pago pendiente de validación. "
    "Espere a que sea validado antes de registrar uno nuevo."
)
MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA = (
    "La persona ya tiene una membresía activa. "
    "Cancele o deje vencer la actual antes de crear una nueva."
)

logger = logging.getLogger("cataclub.servicios.pagos")


# --- Issue #11: descuento congelado, previo a volcarse en columnas de Pago --
@dataclass(frozen=True)
class _DescuentoCongelado:
    descuento_id: int
    valor_aplicado: Decimal
    porcentaje_aplicado: Decimal | None


class MembresiaServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = MembresiaRepositorio(db)
        self.repo_tipo = TipoMembresiaRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)

    def crear_tipo_membresia(self, datos: TipoMembresiaCreateDTO) -> TipoMembresia:
        return self.repo_tipo.crear(TipoMembresia(**datos.model_dump()))

    def listar_tipos_membresia(self) -> list[TipoMembresia]:
        return self.repo_tipo.listar()

    def crear_membresia(self, datos: MembresiaCreateDTO) -> Membresia:
        if not self.repo_persona.obtener_por_id(datos.persona_id):
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        if not self.repo_tipo.obtener_por_id(datos.tipo_membresia_id):
            raise EntidadNoEncontrada(f"Tipo de membresía con id {datos.tipo_membresia_id} no encontrado")
        existentes = self.repo.listar_por_persona(datos.persona_id)
        if any(m.estado == EstadoMembresia.ACTIVA for m in existentes):
            raise OperacionInvalida(MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA)
        # Estado y fecha_activacion NO vienen del payload (B-12): una membresía
        # nace INACTIVA y se ACTIVA al aprobarse su primer pago. La
        # fecha_activacion intermedia es necesaria porque la columna es NOT
        # NULL en el esquema existente; el valor real lo sobreescribe
        # `validar_pago` al aprobar.
        from datetime import datetime, timezone
        membresia = Membresia(
            estado=EstadoMembresia.INACTIVA,
            monto_aplicado=datos.monto_aplicado,
            fecha_activacion=datetime.now(timezone.utc),
            persona_id=datos.persona_id,
            tipo_membresia_id=datos.tipo_membresia_id,
        )
        membresia = self.repo.crear(membresia)
        # Asignación perezosa del rol ALUMNO (principio de diseño ya
        # acordado: se asigna al matricularse, no al crear la cuenta).
        # Best-effort: si la persona aún no tiene Usuario, no hace nada.
        from app.servicios_negocio.rol_servicio import RolServicio
        RolServicio(self.db).asignar_alumno_si_corresponde(datos.persona_id)
        return membresia

    def obtener_membresia(
        self,
        membresia_id: int,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> Membresia:
        """Obtiene una membresía por ID, aplicando autorización
        owner/representative/admin (mismo criterio que listar_membresias_por_persona).
        Sin parámetros de autorización (todos None) se comporta como antes:
        solo existencia; útil para contextos internos donde el caller ya validó."""
        membresia = self.repo.obtener_por_id(membresia_id)
        if not membresia:
            raise EntidadNoEncontrada(f"Membresía con id {membresia_id} no encontrada")

        # Si no hay contexto de autorización, devolver sin filtro (comportamiento
        # anterior preservado para usos internos).
        if persona_id_solicitante is None and not roles_solicitante:
            return membresia

        roles_solicitante = roles_solicitante or []
        es_duenio = persona_id_solicitante == membresia.persona_id
        es_admin = "ADMINISTRADOR" in roles_solicitante
        es_representante = False

        if not es_duenio and not es_admin and persona_id_solicitante is not None:
            persona_objetivo = self.repo_persona.obtener_por_id(membresia.persona_id)
            es_representante = bool(
                persona_objetivo and persona_objetivo.representante_id == persona_id_solicitante
            )

        if not (es_duenio or es_representante or es_admin):
            raise PermisosInsuficientes(
                "Solo la propia persona, su representante, o un administrador "
                "pueden ver esta membresía"
            )
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
        `PagoServicio.listar_pagos_de_persona`: dueño, representante, o
        ADMINISTRADOR; "es representante" solo se resuelve cuando dueño/admin
        no autorizan de entrada."""
        roles_solicitante = roles_solicitante or []
        es_duenio = persona_id_solicitante is not None and persona_id_solicitante == persona_id_objetivo
        es_admin = "ADMINISTRADOR" in roles_solicitante
        es_representante = False

        if not es_duenio and not es_admin and persona_id_solicitante is not None:
            persona_objetivo = self.repo_persona.obtener_por_id(persona_id_objetivo)
            es_representante = bool(
                persona_objetivo and persona_objetivo.representante_id == persona_id_solicitante
            )

        if not (es_duenio or es_representante or es_admin):
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

    def registrar_pago(
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
        es_representante = False

        if not es_duenio and not es_admin and persona_id_solicitante is not None:
            persona_objetivo = self.repo_persona.obtener_por_id(datos.persona_id)
            es_representante = bool(
                persona_objetivo and persona_objetivo.representante_id == persona_id_solicitante
            )

        if not (es_duenio or es_representante or es_admin):
            raise PermisosInsuficientes(
                "Solo la propia persona, su representante, o un administrador "
                "pueden registrar este pago"
            )

        # Issue #11 (modelo firmado §4): aplicar descuentos es decisión del
        # ADMINISTRADOR -- "el admin decide, el sistema registra". El dueño o
        # su representante pueden registrar el pago, pero no adjuntarle
        # descuentos. `persona_id_solicitante` además queda registrado como
        # quien autorizó, así que debe existir en el token.
        if datos.descuento_ids and (not es_admin or persona_id_solicitante is None):
            raise PermisosInsuficientes(
                "Solo un administrador puede aplicar descuentos al registrar un pago"
            )

        # Un pago EFECTIVO es la declaración de quien entregó el dinero -- el
        # dueño del club confirmó (observación de su propio docente) que solo
        # esa persona, o quien paga en su representación, puede hacerla. Un
        # ADMINISTRADOR conserva la vía de TRANSFERENCIA para registrar en
        # nombre de un tercero, pero no puede declarar una entrega de efectivo
        # que no presenció. `es_representante` puede no estar resuelto todavía
        # (el chequeo de arriba lo saltea cuando `es_admin` ya autorizaba de
        # entrada por sí solo), así que se resuelve acá si hace falta.
        if datos.tipo_pago == TipoPago.EFECTIVO and not es_duenio and not es_representante:
            if persona_id_solicitante is not None:
                persona_objetivo = self.repo_persona.obtener_por_id(datos.persona_id)
                es_representante = bool(
                    persona_objetivo and persona_objetivo.representante_id == persona_id_solicitante
                )
            if not es_representante:
                raise PermisosInsuficientes(
                    "El pago en efectivo solo puede registrarlo el propio socio "
                    "o su representante"
                )

        # Recién aquí (ya autorizado) se resuelve existencia real y, si
        # corresponde, el chequeo de solo-lectura financiera para menores
        # (E01-RF006/RF007). No aplica si actúa el representante o un admin.
        if es_duenio and not es_admin and not es_representante:
            persona_objetivo = self.repo_persona.obtener_por_id(datos.persona_id)
            if not persona_objetivo:
                raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
            edad = _calcular_edad(persona_objetivo.fecha_nacimiento)
            if edad < 18:
                raise PermisosInsuficientes(
                    "Los alumnos menores de edad tienen acceso de solo lectura "
                    "al módulo financiero; un representante o el Administrador "
                    "deben registrar este pago"
                )

        membresia = self.repo_membresia.obtener_por_id(datos.membresia_id)
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

        if self.repo.existe_pendiente_para_membresia(datos.membresia_id):
            raise OperacionInvalida(MENSAJE_PAGO_PENDIENTE_DUPLICADO)

        # El monto debe ser un múltiplo exacto del precio mensual de la
        # membresía (se queda: decisiones 2026-08-11 §6 sacó los pagos
        # parciales de alcance). Esto es lo que garantiza que TODO pago
        # represente meses completos, así que el período de abajo puede
        # calcularse en línea recta -- sin saldos, sin estados intermedios.
        precio_mensual = membresia.monto_aplicado
        if precio_mensual > 0 and datos.monto % precio_mensual != 0:
            raise OperacionInvalida(
                f"El monto (${datos.monto}) debe ser múltiplo del precio mensual "
                f"(${precio_mensual})."
            )

        # Fix período de cobertura (PAG-5): antes, `fecha_inicio`/`fecha_fin`
        # llegaban del cliente y el servicio solo confiaba en que una fuera
        # anterior a la otra -- un pago de UN mes podía pedir DOCE de
        # cobertura y el 201 lo aceptaba (agujero reproducido en vivo, ver
        # docs/fixes/06-periodo-de-cobertura.md). Ahora el backend deriva el
        # período: arranca donde termina la del último pago APROBADO (o hoy
        # si no hay ninguno, igual que antes leía el frontend) y avanza
        # tantos meses completos como el monto compre.
        #
        # Importante (decisiones 2026-08-11 §6): "tantos meses como el monto
        # compre" se calcula sobre `datos.monto`, el monto BASE -- ANTES de
        # `_congelar_descuento` más abajo. La membresía anual se vende como
        # descuento del catálogo sobre doce meses adelantados ($300 -> $270);
        # si la cobertura se calculara sobre el monto ya descontado, el padre
        # pagaría doce meses y recibiría once.
        meses = int(datos.monto // precio_mensual) if precio_mensual > 0 else 1
        ultima_fecha_fin = self.repo.fecha_fin_maxima_aprobada(datos.membresia_id)
        hoy = hoy_club()
        ancla = max(ultima_fecha_fin, hoy) if ultima_fecha_fin is not None else hoy
        fecha_inicio, fecha_fin = ancla, _sumar_meses(ancla, meses)

        # Issue #11: resolver el valor VIGENTE del catálogo, congelarlo y
        # descontar el monto base. Las columnas congeladas se asignan al MISMO
        # `Pago` (issue #11 colapsado a columnas: un pago lleva un solo
        # descuento) para que el INSERT sea una sola transacción: no puede
        # quedar un pago descontado sin su detalle.
        descuento_congelado, monto_final = self._congelar_descuento(datos)

        pago = Pago(
            **datos.model_dump(exclude={"descuento_ids"}),
            estado_pago=EstadoPago.PENDIENTE_VALIDACION,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )
        pago.monto = monto_final
        if descuento_congelado is not None:
            pago.descuento_id = descuento_congelado.descuento_id
            pago.descuento_valor_aplicado = descuento_congelado.valor_aplicado
            pago.descuento_porcentaje_aplicado = descuento_congelado.porcentaje_aplicado
            pago.descuento_autorizado_por_persona_id = persona_id_solicitante
        # Red de seguridad del invariante 1 (issue #8): si otra petición
        # concurrente registró su pendiente ENTRE el chequeo de arriba y este
        # INSERT, el índice `uq_pago_pendiente_por_membresia` lo rechaza y se
        # traduce al MISMO error de dominio que habría dado el chequeo. El
        # `rollback()` es obligatorio: un flush fallido deja la sesión
        # inválida para cualquier uso posterior.
        try:
            return self.repo.crear(pago)
        except IntegrityError as error:
            self.db.rollback()
            if "uq_pago_pendiente_por_membresia" in str(error.orig):
                raise OperacionInvalida(MENSAJE_PAGO_PENDIENTE_DUPLICADO) from error
            raise

    # --- Issue #11: descuento aplicado al registrar -----------------------
    def _congelar_descuento(
        self, datos: PagoCreateDTO,
    ) -> tuple[_DescuentoCongelado | None, Decimal]:
        """Resuelve el descuento solicitado contra el catálogo VIGENTE y
        devuelve (descuento congelado o `None`, monto final del pago).
        Quién autoriza NO viaja acá: `registrar_pago` ya lo tiene
        (`persona_id_solicitante`) y lo asigna directo a la columna, sin
        necesidad de un tercer valor de retorno.

        Invariantes firmados (docs/concepto-alcance-modelo.md §4, colapsado a
        columnas de `Pago` -- el dueño confirmó que un pago lleva UN solo
        descuento):
        - Valor congelado: se copia el valor calculado HOY (y el porcentaje
          vigente, si aplica). Cambios posteriores al catálogo no alteran
          estas columnas -- son el hecho histórico.
        - Tope: el descuento no supera el monto base (100 %); no existen
          pagos negativos. Un pago de $0 (beca total) es válido y sigue el
          flujo normal de registro + aprobación.
        - Un descuento inactivo no puede aplicarse (el catálogo es vivo,
          pero solo su presente ofrece; su pasado ya quedó congelado).
        """
        if not datos.descuento_ids:
            return None, datos.monto

        if len(datos.descuento_ids) > 1:
            raise OperacionInvalida("Un pago admite un único descuento")

        descuento = self.repo_descuento.obtener_por_id(datos.descuento_ids[0])
        if not descuento:
            raise EntidadNoEncontrada(f"Descuento con id {datos.descuento_ids[0]} no encontrado")
        if not descuento.activo:
            raise OperacionInvalida(
                f"El descuento '{descuento.nombre}' está inactivo y no puede aplicarse"
            )
        if descuento.porcentaje is not None:
            valor = (datos.monto * descuento.porcentaje / Decimal("100")).quantize(
                Decimal("0.01")
            )
        else:
            valor = descuento.monto

        if valor > datos.monto:
            raise OperacionInvalida(
                "El descuento no puede superar el 100% del monto del pago "
                f"(monto base ${datos.monto}, descuento ${valor})"
            )
        return (
            _DescuentoCongelado(
                descuento_id=descuento.id,
                valor_aplicado=valor,
                porcentaje_aplicado=descuento.porcentaje,
            ),
            datos.monto - valor,
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
        """
        pago = self.repo.obtener_por_id(pago_id)
        if not pago:
            raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")

        if persona_id_solicitante is None and not roles_solicitante:
            return pago

        PoliticaAccesoPersona(self.db).exigir_acceso(
            persona_id_objetivo=pago.persona_id,
            persona_id_solicitante=persona_id_solicitante,
            roles_solicitante=roles_solicitante,
            mensaje=(
                "Solo el titular del pago, su representante, o un "
                "administrador pueden consultarlo"
            ),
        )
        return pago

    def _url_entrega_voucher(self, pago: Pago) -> str | None:
        """Traduce `pago.voucher_url` (persistido) a una URL de entrega
        vigente. Se llama SOLO desde los puntos que efectivamente responden
        al cliente HTTP (nunca desde `obtener_pago`, reusado internamente
        por `validar_pago`/`adjuntar_comprobante`/`adjuntar_voucher` sin
        pasar por este chequeo), para que la firma se genere después de que
        la autorización ya pasó, no antes."""
        from app.infraestructura.cloudinary_cliente import resolver_url_entrega

        if not pago.voucher_url:
            return None
        es_pdf = pago.voucher_formato == "application/pdf"
        return resolver_url_entrega(
            pago.voucher_url,
            resource_type="raw" if es_pdf else "image",
            formato="pdf" if es_pdf else None,
        )

    def pago_a_response_dto(self, pago: Pago) -> PagoResponseDTO:
        """Punto único donde un `Pago` ORM se convierte en la respuesta HTTP:
        reemplaza el `voucher_url` persistido (un `public_id`, o una URL
        pública heredada de antes del fix) por una URL de entrega firmada
        fresca. Los routers de lectura (`GET /pagos/{id}`, `GET
        /pagos/persona/{id}`, `PATCH /pagos/{id}/validar`, `POST
        /pagos/{id}/voucher`) deben pasar por acá en vez de devolver el
        `Pago` directo -- devolverlo directo filtraría el `public_id` o la
        URL heredada tal cual, sin firmar."""
        dto = PagoResponseDTO.model_validate(pago)
        return dto.model_copy(update={"voucher_url": self._url_entrega_voucher(pago)})

    def listar_pagos_de_persona(
        self,
        persona_id_objetivo: int,
        persona_id_solicitante: int | None = None,
        roles_solicitante: list[str] | None = None,
    ) -> list[Pago]:
        """Historial completo (cualquier estado) de los pagos de una persona,
        para que el propio alumno o su representante puedan ver su historial
        financiero (lectura, sin exponer subida/registro de comprobante --
        eso sigue siendo otro flujo). Misma autorización que `registrar_pago`:
        dueño, su representante, o ADMINISTRADOR; "es representante" solo se
        resuelve cuando dueño/admin no autorizan de entrada (ver docstring
        allá). No se extrae un helper compartido con `registrar_pago`/
        `adjuntar_voucher`: ambos ya duplican este mismo chequeo localmente
        en este archivo en vez de compartirlo, así que duplicarlo una tercera
        vez es lo consistente con el estilo ya establecido acá."""
        roles_solicitante = roles_solicitante or []
        es_duenio = persona_id_solicitante is not None and persona_id_solicitante == persona_id_objetivo
        es_admin = "ADMINISTRADOR" in roles_solicitante
        es_representante = False

        if not es_duenio and not es_admin and persona_id_solicitante is not None:
            persona_objetivo = self.repo_persona.obtener_por_id(persona_id_objetivo)
            es_representante = bool(
                persona_objetivo and persona_objetivo.representante_id == persona_id_solicitante
            )

        if not (es_duenio or es_representante or es_admin):
            raise PermisosInsuficientes(
                "Solo la propia persona, su representante, o un administrador "
                "pueden ver este historial de pagos"
            )

        return self.repo.listar_por_persona(persona_id_objetivo)

    def listar_pagos(
        self,
        estado_pago: EstadoPago | None = None,
        skip: int = 0,
        limit: int = 50,
        fecha_inicio: date | None = None,
        fecha_fin: date | None = None,
    ) -> tuple[list[PagoListItemDTO], int]:
        """Cola de validación (Administrador) y reporte de pagos. Construye
        PagoListItemDTO a mano (en vez de from_attributes directo) porque
        `persona_nombre_completo` no es una columna de Pago: se arma a partir
        de la relación cargada (ver joinedload en el repositorio, evita N+1
        queries)."""
        pagos = self.repo.listar(
            estado_pago=estado_pago, skip=skip, limit=limit,
            fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
        )
        total = self.repo.contar(estado_pago=estado_pago, fecha_inicio=fecha_inicio, fecha_fin=fecha_fin)
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
                persona_nombre_completo=f"{p.persona.nombres} {p.persona.apellidos}",
                membresia_id=p.membresia_id,
                voucher_url=self._url_entrega_voucher(p),
                voucher_formato=p.voucher_formato,
            )
            for p in pagos
        ]
        return items, total

    def validar_pago(self, pago_id: int, datos: PagoValidarDTO) -> Pago:
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
        """
        pago = self.repo.obtener_por_id_con_bloqueo(pago_id)
        if not pago:
            raise EntidadNoEncontrada(f"Pago con id {pago_id} no encontrado")

        if pago.estado_pago != EstadoPago.PENDIENTE_VALIDACION:
            raise OperacionInvalida(
                "Solo un pago pendiente de validación puede aprobarse o "
                f"rechazarse; este pago ya está "
                f"{estado_de_pago_en_castellano(pago.estado_pago)}.",
                detalle_tecnico=f"pago_id={pago_id} estado_pago={pago.estado_pago.value}",
            )

        pago.estado_pago = datos.estado_pago
        pago.motivo_rechazo = datos.motivo_rechazo
        pago.fecha_validacion = datetime.now(timezone.utc)

        if datos.estado_pago == EstadoPago.APROBADO:
            # Si el admin corrigió las fechas, aplicarlas al pago.
            if datos.fecha_inicio is not None and datos.fecha_fin is not None:
                pago.fecha_inicio = datos.fecha_inicio
                pago.fecha_fin = datos.fecha_fin

            membresia = pago.membresia
            membresia.estado = EstadoMembresia.ACTIVA
            membresia.fecha_activacion = datetime(
                year=pago.fecha_inicio.year,
                month=pago.fecha_inicio.month,
                day=pago.fecha_inicio.day,
                tzinfo=timezone.utc,
            )

            # Flush pending changes before counting active family memberships.
            # With autoflush=False, the ACTIVA state set above is not visible
            # to subsequent DB queries unless we explicitly flush. The 4th-family
            # gratuity rule (E04-RF002) depends on an accurate count, which
            # includes the membership we just activated.
            #
            # Red de seguridad del invariante 2 (issue #8): aprobar es el
            # ÚNICO escritor de ACTIVA, y `crear_membresia` no puede ver la
            # carrera de dos membresías INACTIVAS de la misma persona cuyos
            # pagos se aprueban a la vez (o una segunda aprobación con otra
            # ya activa). El índice `uq_membresia_activa_por_persona` la
            # rechaza en el flush/commit y se traduce al MISMO error de
            # dominio que da el chequeo de `crear_membresia`. El `rollback()`
            # es obligatorio: un flush fallido deja la sesión inválida.
            try:
                self.db.flush()
                self._aplicar_regla_familiar_si_corresponde(membresia, pago)
                self.repo.guardar_cambios(pago)
            except IntegrityError as error:
                self.db.rollback()
                if "uq_membresia_activa_por_persona" in str(error.orig):
                    raise OperacionInvalida(MENSAJE_MEMBRESIA_ACTIVA_DUPLICADA) from error
                raise
            self._crear_notificacion_pago(
                pago=pago,
                tipo=TipoNotificacion.PAGO_APROBADO,
                mensaje=f"Tu pago de ${pago.monto} fue aprobado. Tu membresía está activa.",
            )
            # Último paso, ya con la aprobación commiteada: si el broker está
            # caído, el método loguea y NO propaga (ver su docstring).
            self._disparar_generacion_comprobante_pdf(pago_id)
        else:
            # EstadoPago.RECHAZADO: el estado de Membresia no cambia; el rechazo
            # queda registrado únicamente en Pago.estado_pago y Pago.motivo_rechazo.
            self.repo.guardar_cambios(pago)
            motivo = f": {pago.motivo_rechazo}" if pago.motivo_rechazo else ""
            self._crear_notificacion_pago(
                pago=pago,
                tipo=TipoNotificacion.PAGO_RECHAZADO,
                mensaje=f"Tu pago fue rechazado{motivo}.",
            )
        return pago

    # --- E04-RF002: gratuidad del 4to miembro -------------------------------
    def _aplicar_regla_familiar_si_corresponde(self, membresia: Membresia, pago: Pago) -> None:
        """
        Si la persona representada (alumno) tiene un representante, y ese
        representante ya tiene 3 membresías activas en el mismo periodo (solapa
        la fecha_fin de este pago), entonces este pago activa la gratuidad:
        monto_aplicado -> 0.

        La propia membresía que acabamos de activar queda incluida en el conteo
        (ya está ACTIVA y solapa), de modo que si el total familiar llega a 4
        (es el 4to miembro) aplicamos gratuidad a ESTA membresía en concreto.
        Solo aplica a personas con representante; una persona sin representante
        no entra en la regla familiar.
        """
        persona = self.repo_persona.obtener_por_id(membresia.persona_id)
        if not persona or not persona.representante_id:
            return None

        en_fecha = pago.fecha_fin
        activas_familia = self.repo_membresia.contar_membresias_activas_familia(
            persona.representante_id, en_fecha
        )

        if activas_familia >= FAMILIA_UMBRAL_GRATUIDAD + 1:
            membresia.monto_aplicado = Decimal("0.00")
            membresia.es_gratuidad_familiar = True
        return None

    def _crear_notificacion_pago(self, pago: Pago, tipo: TipoNotificacion, mensaje: str) -> None:
        persona = self.repo_persona.obtener_por_id(pago.persona_id)
        if not persona:
            return
        notif = Notificacion(
            tipo=tipo,
            mensaje=mensaje,
            persona_id=persona.id,
            entidad_relacionada_id=pago.id,
        )
        self.repo_notificacion.crear(notif)
        if persona.representante_id:
            notif_rep = Notificacion(
                tipo=tipo,
                mensaje=f"Para {persona.nombres} {persona.apellidos}: {mensaje}",
                persona_id=persona.representante_id,
                entidad_relacionada_id=pago.id,
            )
            self.repo_notificacion.crear(notif_rep)

    def adjuntar_comprobante(self, pago_id: int, datos: ComprobantePagoCreateDTO) -> ComprobantePago:
        pago = self.obtener_pago(pago_id)
        if pago.comprobante:
            raise OperacionInvalida("Este pago ya tiene un comprobante adjunto")
        comprobante = ComprobantePago(**datos.model_dump(), pago_id=pago_id)
        return self.repo_comprobante.crear(comprobante)

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
          1. El pago existe (404 EntidadNoEncontrada)
          2. Pago está PENDIENTE_VALIDACION (400 OperacionInvalida)
          3. Solicitante es el dueño del pago o admin (403 PermisosInsuficientes)
          4. content_type permitido JPG/PNG/PDF (400 OperacionInvalida)
          4b. la firma binaria real coincide con el tipo declarado (400
              OperacionInvalida) -- REQ-SEC-3, sdd/production-readiness
          5. tamaño <= 5 MB (400 OperacionInvalida)
          6. Subida a Cloudinary (carpeta vouchers) + commit en Pago.

        Se permite SOBREESCRIBIR un voucher ya existente mientras el pago siga
        PENDIENTE_VALIDACION (el cliente puede corregir una subida errónea).
        """
        # 1. Pago existe (lanza EntidadNoEncontrada si no).
        pago = self.obtener_pago(pago_id)

        # 2. Estado válido para adjuntar voucher.
        if pago.estado_pago != EstadoPago.PENDIENTE_VALIDACION:
            raise OperacionInvalida(
                "Solo se puede adjuntar voucher a un pago pendiente de validación"
            )

        # 3. Autorización: dueño del pago, su representante, o admin.
        persona_titular = pago.persona
        es_duenio = persona_id_solicitante is not None and persona_id_solicitante == pago.persona_id
        es_representante = (
            persona_id_solicitante is not None
            and persona_titular.representante_id == persona_id_solicitante
        )
        es_admin = "ADMINISTRADOR" in roles_solicitante
        if not (es_duenio or es_representante or es_admin):
            raise PermisosInsuficientes(
                "Solo el titular del pago, su representante, o un administrador "
                "pueden adjuntar el voucher"
            )

        # E01-RF006/RF007: mismo criterio de solo-lectura financiera para
        # menores que en registrar_pago (ver docstring allá).
        if es_duenio and not es_admin and not es_representante:
            edad = _calcular_edad(persona_titular.fecha_nacimiento)
            if edad < 18:
                raise PermisosInsuficientes(
                    "Los alumnos menores de edad tienen acceso de solo lectura "
                    "al módulo financiero; un representante o el Administrador "
                    "deben adjuntar este voucher"
                )

        # 4. Tipo MIME permitido.
        if not content_type or content_type not in TIPOS_MIME_PERMITIDOS_VOUCHER:
            raise OperacionInvalida("Formato de archivo no permitido. Use JPG, PNG o PDF")

        # 4b. La firma binaria real debe coincidir con el tipo declarado: el
        # Content-Type que manda el cliente no prueba nada sobre el
        # contenido real (decisión de diseño 2.3, sdd/production-readiness).
        if not es_firma_valida(contenido, content_type):
            raise OperacionInvalida(
                "El contenido del archivo no coincide con el formato declarado"
            )

        # 5. Tamaño máximo. Defensa en profundidad: el router ya acota la
        # lectura vía `leer_con_limite` antes de llegar acá, pero este
        # chequeo protege a cualquier otro llamador futuro de este método
        # que no pase por esa ruta.
        if len(contenido) > TAMANO_MAXIMO_VOUCHER_BYTES:
            raise OperacionInvalida("El archivo excede el tamaño máximo de 5MB")

        # 6. Subida a Cloudinary y persistencia en Pago (sobrescribe si ya había).
        from app.infraestructura.cloudinary_cliente import subir_voucher_pago

        public_id = f"voucher-pago-{pago_id:08d}"
        subir_voucher_pago(
            contenido=contenido,
            nombre_publico=public_id,
            content_type=content_type,
            pago_id=pago_id,
        )

        # Se persiste el public_id, NO una URL: el voucher se sube como
        # `type="authenticated"` (hallazgo de privacidad "voucher no
        # enumerable"), así que la URL que devuelve el SDK no sirve para
        # nada sin firmar. La URL de entrega se genera fresca en cada
        # lectura autorizada -- ver `_url_entrega_voucher` /
        # `cloudinary_cliente.resolver_url_entrega` -- para que nunca quede
        # una firma vieja atascada en la fila.
        # voucher_formato: guardamos el content_type exacto para distinguir
        # jpg/png/pdf al derivar el `resource_type` de la firma y al
        # renderizar el voucher en el frontend.
        pago.voucher_url = public_id
        pago.voucher_formato = content_type
        pago.voucher_fecha_carga = datetime.now(timezone.utc)

        return self.repo.guardar_cambios(pago)

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
