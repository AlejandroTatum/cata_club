from datetime import datetime, date, timezone
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import Membresia, TipoMembresia, Pago, ComprobantePago, Notificacion
from app.dominio.enums import EstadoPago, EstadoMembresia, TipoNotificacion
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida, PermisosInsuficientes
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio, TipoMembresiaRepositorio
from app.infraestructura.repositorios.pago_repositorio import PagoRepositorio, ComprobantePagoRepositorio
from app.infraestructura.repositorios.ranking_repositorio import NotificacionRepositorio
from app.servicios_negocio.persona_servicio import _calcular_edad
from app.servicios_negocio.politica_acceso import PoliticaAccesoPersona
from app.presentacion.schemas.membresia_pago_schemas import (
    TipoMembresiaCreateDTO, MembresiaCreateDTO, PagoCreateDTO, PagoValidarDTO, ComprobantePagoCreateDTO,
    PagoListItemDTO,
)


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
            raise OperacionInvalida(
                "La persona ya tiene una membresía activa. "
                "Cancele o deje vencer la actual antes de crear una nueva."
            )
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

        if self.repo.existe_pendiente_para_membresia(datos.membresia_id):
            raise OperacionInvalida(
                "Esta membresía ya tiene un pago pendiente de validación. "
                "Espere a que sea validado antes de registrar uno nuevo."
            )

        # El monto debe ser un múltiplo exacto del precio mensual de la membresía.
        precio_mensual = membresia.monto_aplicado
        if precio_mensual > 0 and datos.monto % precio_mensual != 0:
            raise OperacionInvalida(
                f"El monto (${datos.monto}) debe ser múltiplo del precio mensual "
                f"(${precio_mensual})."
            )

        pago = Pago(**datos.model_dump(), estado_pago=EstadoPago.PENDIENTE_VALIDACION)
        return self.repo.crear(pago)

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
                voucher_url=p.voucher_url,
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
          PDF + subida a Cloudinary (vía Celery).
        """
        pago = self.obtener_pago(pago_id)
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
            self.db.flush()

            self._aplicar_regla_familiar_si_corresponde(membresia, pago)

            self.repo.guardar_cambios(pago)
            self._disparar_generacion_comprobante_pdf(pago_id)
            self._crear_notificacion_pago(
                pago=pago,
                tipo=TipoNotificacion.PAGO_APROBADO,
                mensaje=f"Tu pago de ${pago.monto} fue aprobado. Tu membresía está activa.",
            )
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

        # 5. Tamaño máximo.
        if len(contenido) > TAMANO_MAXIMO_VOUCHER_BYTES:
            raise OperacionInvalida("El archivo excede el tamaño máximo de 5MB")

        # 6. Subida a Cloudinary y persistencia en Pago (sobrescribe si ya había).
        from app.infraestructura.cloudinary_cliente import subir_voucher_pago

        public_id = f"voucher-pago-{pago_id:08d}"
        url = subir_voucher_pago(
            contenido=contenido,
            nombre_publico=public_id,
            content_type=content_type,
            pago_id=pago_id,
        )

        # voucher_formato: guardamos el content_type exacto para distinguir
        # jpg/png/pdf en el frontend al renderizar el voucher.
        pago.voucher_url = url
        pago.voucher_formato = content_type
        pago.voucher_fecha_carga = datetime.now(timezone.utc)

        return self.repo.guardar_cambios(pago)

    # --- Disparo asíncrono del comprobante PDF -------------------------------
    def _disparar_generacion_comprobante_pdf(self, pago_id: int) -> None:
        """
        Encola la tarea Celery que genera el PDF del comprobante aprobado y lo
        sube a Cloudinary. Import diferido para evitar dependencia circular
        (celery_app importa tareas, tareas importan configuración, no servicios).
        """
        from app.infraestructura.tareas.comprobante_tareas import generar_comprobante_pdf_tarea

        generar_comprobante_pdf_tarea.delay(pago_id)
