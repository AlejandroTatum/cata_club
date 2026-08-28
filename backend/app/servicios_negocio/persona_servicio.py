import logging
import time
from datetime import date
from typing import Callable
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Usuario, FichaMedica, Enfermedades, Notificacion, VinculacionRepresentante
from app.dominio.enums import TipoRol, TipoNotificacion
from app.dominio.excepciones import (
    EntidadNoEncontrada, EntidadDuplicada, OperacionInvalida, PermisosInsuficientes,
)
from app.dominio.mensajes import (
    MENSAJE_CORREO_SIN_VERIFICAR, MENSAJE_IDENTIDAD_DUPLICADA,
    MENSAJE_VINCULACION_NO_DISPONIBLE,
)
from app.dominio.rol_unico import exigir_rol_unico
from app.soporte_transversal.tiempo import hoy_club
from app.soporte_transversal.firma_archivos import es_firma_valida
from app.seguridad.gestor_auth import GestorAutenticacion
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import (
    UsuarioRepositorio, FichaMedicaRepositorio,
)
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio
from app.infraestructura.repositorios.notificacion_repositorio import NotificacionRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.servicios_negocio.notificacion_servicio import acortar_nombre_para_notificacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.presentacion.schemas.persona_schemas import (
    PersonaCreateDTO, PersonaUpdateDTO, RepresentadoCreateDTO, IndependizarDTO,
    VincularRepresentadoDTO,
)

logger = logging.getLogger("cataclub.servicios.personas")


# --- Restricciones de dominio: edad y tutor legal ---------------------------
# Solo se admiten alumnos entre 5 y 74 años. Si el alumno es menor de edad
# (5 a 17 años), el Representante/Tutor legal es OBLIGATORIO; no basta con
# que la columna sea nullable a nivel de BD: la regla se aplica en el
# servicio de dominio, no en el ORM ni en el router.
EDAD_MINIMA_ALUMNO = 5
EDAD_MAXIMA_ALUMNO = 74
EDAD_MAYORIA_EDAD = 18


def _calcular_edad(fecha_nacimiento: date, referencia: date | None = None) -> int:
    # Día del CLUB, no del contenedor: un cumpleaños ocurre a la medianoche
    # LOCAL, y de esta edad depende si el alumno necesita representante legal.
    # Con `date.today()` (UTC) el alumno "cumplía años" cinco horas antes.
    ref = referencia or hoy_club()
    anos = ref.year - fecha_nacimiento.year
    if (ref.month, ref.day) < (fecha_nacimiento.month, fecha_nacimiento.day):
        anos -= 1
    return anos


# --- INS-2: freno progresivo de intentos de vinculación ---------------------
# Mismo patrón que `AuthServicio._INTENTOS_FALLIDOS_LOGIN` (TRA-4,
# docs/product/decisiones-de-negocio-2026-08-11.md §3): un dict a nivel de módulo,
# simplificación aceptada para el alcance del proyecto (no sobrevive un
# reinicio del proceso ni se comparte entre réplicas). Acá la clave es el
# `representante_id` (el actor autenticado), no un correo -- el guardarraíl
# 4 de la sección 1 pide frenar a QUIEN prueba cédulas en serie, y esa
# identidad ya está resuelta por el token antes de llegar al servicio.
_INTENTOS_FALLIDOS_VINCULACION: dict[int, int] = {}
_UMBRAL_RETRASO_VINCULACION = 3
_TECHO_RETRASO_VINCULACION_SEGUNDOS = 30


def _calcular_retraso_vinculacion(intentos_fallidos: int) -> int:
    """Sin retraso antes del 3er intento fallido; 1s al 3ro, duplicando en
    cada intento siguiente, techo de 30s. Nunca bloqueo duro -- un
    representante real puede simplemente estar recordando mal un dígito."""
    if intentos_fallidos < _UMBRAL_RETRASO_VINCULACION:
        return 0
    exponente = intentos_fallidos - _UMBRAL_RETRASO_VINCULACION
    return min(2 ** exponente, _TECHO_RETRASO_VINCULACION_SEGUNDOS)


class PersonaServicio:
    """Contiene las reglas de negocio de Persona. No conoce FastAPI ni HTTPException;
    comunica errores mediante excepciones de dominio."""

    def __init__(self, db: Session, dormir: Callable[[float], None] = time.sleep):
        self.db = db
        self.repo = PersonaRepositorio(db)
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_rol = RolRepositorio(db)
        # Inyectable para tests (ningún test hace un sleep real de varios
        # segundos, mismo criterio que `AuthServicio`). Los routers de
        # producción no pasan `dormir`, así que usan el `time.sleep` real.
        self._dormir = dormir

    def registrar_persona(self, datos: PersonaCreateDTO) -> Persona:
        if self.repo.obtener_por_cedula(datos.cedula):
            raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)

        edad = _calcular_edad(datos.fecha_nacimiento)
        if edad < EDAD_MINIMA_ALUMNO or edad > EDAD_MAXIMA_ALUMNO:
            raise OperacionInvalida(
                f"La edad del alumno debe estar entre {EDAD_MINIMA_ALUMNO} y "
                f"{EDAD_MAXIMA_ALUMNO} años (calculado: {edad})."
            )
        if EDAD_MINIMA_ALUMNO <= edad < EDAD_MAYORIA_EDAD and not datos.representante_id:
            raise OperacionInvalida(
                "El alumno es menor de edad (5 a 17 años): debe indicar los datos "
                "del representante o tutor legal.",
                detalle_tecnico="falta representante_id en un alta de alumno menor",
            )

        if datos.representante_id:
            representante = self.repo.obtener_por_id(datos.representante_id)
            if not representante:
                raise EntidadNoEncontrada(f"Representante con id {datos.representante_id} no encontrado")
            # El representante legal debe ser mayor de edad: una persona menor
            # no puede ser tutor legal de otra (regla de dominio, no de ORM).
            edad_representante = _calcular_edad(representante.fecha_nacimiento)
            if edad_representante < EDAD_MAYORIA_EDAD:
                raise OperacionInvalida(
                    f"El representante legal debe ser mayor de edad "
                    f"({EDAD_MAYORIA_EDAD} años o más); el representante indicado "
                    f"tiene {edad_representante} años."
                )

        nueva_persona = Persona(**datos.model_dump())
        return self.repo.crear(nueva_persona)

    def crear_representado(self, representante_id: int, datos: RepresentadoCreateDTO) -> Persona:
        """Crea un dependiente (menor) para un representante o desde el panel admin.

        Flujo:
        1. Crear Persona (vía `registrar_persona`, reusando reglas de edad/duplicado).
        2. Crear FichaMedica si se proporcionó.
        3. Si se proporcionaron `correo` + `contrasenia`: crear Usuario con
           rol ALUMNO para el menor (Opción B: menores con cuenta propia).

        Nota: igual que `EnrollmentServicio`, cada `repo.crear()` hace su
        propio commit. Riesgo heredado, no introducido aquí."""
        persona_datos = PersonaCreateDTO(
            nombres=datos.nombres,
            apellidos=datos.apellidos,
            cedula=datos.cedula,
            fecha_nacimiento=datos.fecha_nacimiento,
            telefono=datos.telefono,
            representante_id=representante_id,
            institucion_id=datos.institucion_id,
        )
        representado = self.registrar_persona(persona_datos)

        if datos.ficha_medica:
            ficha = FichaMedica(
                tipo_sangre=datos.ficha_medica.tipo_sangre,
                persona_id=representado.id,
                alergias=datos.ficha_medica.alergias,
                contacto_emergencia=datos.ficha_medica.contacto_emergencia,
                telefono_emergencia=datos.ficha_medica.telefono_emergencia,
            )
            for nombre in datos.ficha_medica.enfermedades:
                ficha.enfermedades.append(Enfermedades(nombre_enfermedad=nombre))
            FichaMedicaRepositorio(self.db).crear(ficha)

        # Opción B: si el admin/representante provee credenciales,
        # crear también el Usuario + rol ALUMNO para el menor.
        if datos.correo and datos.contrasenia:
            if self.repo_usuario.obtener_por_correo(datos.correo):
                raise EntidadDuplicada(MENSAJE_IDENTIDAD_DUPLICADA)
            from app.seguridad.gestor_auth import GestorAutenticacion
            hash_pw = GestorAutenticacion.obtener_hash_contrasenia(datos.contrasenia)
            usuario = Usuario(
                correo=datos.correo,
                contrasenia=hash_pw,
                persona_id=representado.id,
            )
            self.repo_usuario.crear(usuario)
            self._asignar_rol(usuario, TipoRol.ALUMNO)

        return representado

    # --- INS-2: vincular un representado ya existente ------------------------
    # docs/product/decisiones-de-negocio-2026-08-11.md §1: "Un chico tiene un solo
    # representante, y el representante lo vincula solo". Antes no existía
    # ninguna vía (ni endpoint ni pantalla) para pasar una Persona ya
    # registrada de un representante a otro, pese a que el mensaje de cédula
    # duplicada se lo prometía al usuario (INS-2).
    def vincular_representado(
        self, representante_id: int, datos: VincularRepresentadoDTO
    ) -> Persona:
        """Vincula a `representante_id` una Persona YA EXISTENTE (típicamente
        cargada por otro representante), identificada por cédula. Sin
        aprobación de nadie -- decisión de negocio explícita, ver docstring
        del módulo de tests `test_vinculacion_representado.py`. Cuatro
        guardarraíles, ninguno agrega un clic al padre que vincula:

        1. Auditoría: la vinculación exitosa deja una fila en
           `VinculacionRepresentante` (quién, a quién, cuándo).
        2. Si el representado ya tenía representante, se le notifica
           DESPUÉS del hecho por el feed de notificaciones existente.
           "Deshacerlo" es repetir esta misma llamada con la misma cédula
           -- que el representante anterior ya conocía, porque fue quien
           dio de alta a ese representado.
        3. ANTI-ENUMERACIÓN: toda falla de elegibilidad -- cédula
           inexistente, representado mayor de edad, ya vinculado a este
           mismo representante, o la cédula del propio representante --
           levanta el MISMO error (`MENSAJE_VINCULACION_NO_DISPONIBLE`).
           Ni el mensaje ni el código HTTP distinguen "no existe" de "existe
           pero no es elegible": esta llamada NUNCA revela el nombre de la
           persona antes de vincularla.
        4. Tope de intentos: freno progresivo por representante (mismo
           patrón que `AuthServicio._calcular_retraso_login`, nunca bloqueo
           duro).
        5. Issue #790: la cuenta que ejerce esta capacidad tiene que haber
           probado el control de su dirección de correo. Es lo ÚNICO que
           agrega ese issue, y no toca ninguno de los cuatro guardarraíles
           de arriba: la vinculación sigue sin requerir la aprobación de
           nadie.

        Por qué el candado va acá y no en el rol ni en la política de acceso:
        `REPRESENTANTE` desbloquea también cosas inofensivas, y
        `PoliticaAccesoPersona` concede a partir de `representante_id`, que es
        el vínculo que un representante recién inscripto YA tiene sobre el
        hijo que él mismo dio de alta. Cerrar ahí dejaría a una familia real
        sin acceso a la ficha de su propio chico mientras espera un correo.
        Esta llamada es la única que ATA una cuenta a una persona que no creó,
        que es exactamente el paso que convierte "controlo una dirección de
        correo" en "puedo leer y escribir la ficha médica de un menor".
        """
        self._exigir_correo_verificado_del_representante(representante_id)

        try:
            representado = self._resolver_representado_elegible(representante_id, datos.cedula)
        except OperacionInvalida:
            self._penalizar_intento_fallido_vinculacion(representante_id)
            raise

        _INTENTOS_FALLIDOS_VINCULACION.pop(representante_id, None)

        representante_anterior_id = representado.representante_id
        self.repo.actualizar(representado, {"representante_id": representante_id})

        self.db.add(VinculacionRepresentante(
            persona_id=representado.id,
            representante_anterior_id=representante_anterior_id,
            representante_nuevo_id=representante_id,
        ))
        self.db.commit()

        if representante_anterior_id is not None:
            self._notificar_representante_anterior(representado, representante_anterior_id)

        return representado

    def _exigir_correo_verificado_del_representante(self, representante_id: int) -> None:
        """Issue #790: la cuenta a la que va a quedar atado el representado
        tiene que haber probado que su dirección de correo es suya.

        Se evalúa sobre la CUENTA destino, no sobre el rol de quien llama.
        Una Persona sin cuenta -- un tutor que el club cargó a mano, sin
        login -- no tiene ninguna dirección que probar y no gana ninguna
        credencial con la vinculación, así que no se le bloquea nada: exigirle
        una verificación imposible solo impediría trabajar al administrador
        que lo está ayudando.

        Corre ANTES de resolver la elegibilidad, y a propósito fuera del
        `try` que penaliza: el freno progresivo existe para castigar a quien
        prueba cédulas en serie, y un correo sin verificar no es un intento
        fallido de adivinanza. Gastarle intentos al representante real solo lo
        haría esperar de más por algo que no hizo mal. Además, resolver
        primero significaría consultar la cédula buscada antes de saber si
        quien pregunta puede preguntar.
        """
        cuenta = self.repo_usuario.obtener_por_persona_id(representante_id)
        if cuenta is not None and not cuenta.correo_verificado:
            raise PermisosInsuficientes(MENSAJE_CORREO_SIN_VERIFICAR)

    def _resolver_representado_elegible(self, representante_id: int, cedula: str) -> Persona:
        """Devuelve la Persona elegible para ser vinculada, o levanta
        `OperacionInvalida` con el mensaje genérico -- NUNCA revela cuál de
        los motivos de rechazo aplicó (guardarraíl 3 de arriba)."""
        candidato = self.repo.obtener_por_cedula(cedula)
        elegible = (
            candidato is not None
            and candidato.id != representante_id
            and candidato.representante_id != representante_id
            and _calcular_edad(candidato.fecha_nacimiento) < EDAD_MAYORIA_EDAD
        )
        if not elegible:
            motivo = (
                "cédula inexistente" if candidato is None
                else f"persona_id={candidato.id} no elegible (self/ya vinculada/mayor de edad)"
            )
            raise OperacionInvalida(
                MENSAJE_VINCULACION_NO_DISPONIBLE,
                detalle_tecnico=(
                    f"vinculación rechazada para representante_id={representante_id}: {motivo}"
                ),
            )
        return candidato

    def _penalizar_intento_fallido_vinculacion(self, representante_id: int) -> None:
        intentos = _INTENTOS_FALLIDOS_VINCULACION.get(representante_id, 0) + 1
        _INTENTOS_FALLIDOS_VINCULACION[representante_id] = intentos
        retraso = _calcular_retraso_vinculacion(intentos)
        if retraso:
            self._dormir(retraso)

    def _notificar_representante_anterior(self, representado: Persona, representante_anterior_id: int) -> None:
        """Avisa al representante anterior (guardarraíl 2 de la decisión).

        No relanza si el aviso falla: la vinculación en sí YA está
        commiteada (`self.db.commit()` corre antes, en `vincular_representado`),
        así que un fallo acá no puede tirar la petición entera -- se loguea
        con traceback completo (nunca en silencio) y la vinculación sigue
        siendo válida. Mismo patrón que
        `PagoServicio._disparar_generacion_comprobante_pdf`: un efecto
        posterior al hecho principal no debe deshacer ni ocultar que el hecho
        principal ya ocurrió (hallazgo en vivo, 2026-08-11: antes de este fix
        un nombre real largo hacía `DataError` acá por VARCHAR(255))."""
        nombre = acortar_nombre_para_notificacion(f"{representado.nombres} {representado.apellidos}")
        try:
            NotificacionRepositorio(self.db).crear(Notificacion(
                tipo=TipoNotificacion.VINCULACION_REPRESENTANTE,
                mensaje=(
                    f"{nombre} (cédula {representado.cedula}) fue vinculado a otra cuenta "
                    f"de representante. Si fue un error, complete \"Agregar dependiente\" "
                    f"con la misma cédula para deshacerlo."
                ),
                persona_id=representante_anterior_id,
                entidad_relacionada_id=representado.id,
            ))
        except Exception:
            self.db.rollback()
            logger.exception(
                "No se pudo avisar al representante anterior (persona_id=%s) de la "
                "vinculación de persona_id=%s. La vinculación YA está commiteada.",
                representante_anterior_id, representado.id,
            )

    def _asignar_rol(self, usuario: Usuario, tipo_rol: TipoRol) -> None:
        """Asigna un rol al usuario si aún no lo tiene (idempotente).

        Regla de un solo rol activo compartida (issue #762)."""
        if not exigir_rol_unico(usuario, tipo_rol):
            return
        rol = self.repo_rol.obtener_o_crear(tipo_rol)
        usuario.roles.append(rol)
        self.db.commit()

    def listar_personas(self, skip: int = 0, limit: int = 50) -> tuple[list[Persona], int]:
        items = self.repo.listar(skip, limit)
        total = self.repo.contar()
        return items, total

    def obtener_persona(self, persona_id: int) -> Persona:
        persona = self.repo.obtener_por_id(persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")
        return persona

    def listar_representados(self, persona_id: int) -> list[Persona]:
        """Dependientes ACTIVOS. `obtener_persona` se conserva para que un
        `persona_id` inexistente siga dando 404 y no una lista vacía."""
        self.obtener_persona(persona_id)
        return self.repo.listar_representados(persona_id)

    def actualizar_persona(self, persona_id: int, cambios: PersonaUpdateDTO) -> Persona:
        persona = self.obtener_persona(persona_id)
        datos = cambios.model_dump(exclude_unset=True)
        return self.repo.actualizar(persona, datos)

    # --- Foto de una persona (carnet de socio, issue #286) -------------------
    # Misma validación + subida que `AuthServicio.actualizar_foto_perfil`
    # (`POST /auth/me/foto`), pero sobre una Persona OBJETIVO y no sobre la
    # persona del token. El permiso de QUIÉN puede subirla lo resuelve el
    # router con `PoliticaAccesoPersona.exigir_acceso` (dueño, su
    # representante, o ADMINISTRADOR). El `public_id` deriva del
    # `persona_id` del objetivo, así una foto nueva SOBRESCRIBE la anterior
    # en Cloudinary (mismo criterio que el self-service).
    def actualizar_foto(self, persona_id: int, contenido: bytes, content_type: str) -> Persona:
        persona = self.obtener_persona(persona_id)

        if content_type not in AuthServicio.TIPOS_MIME_PERMITIDOS_FOTO_PERFIL:
            raise OperacionInvalida("Formato de archivo no permitido. Use JPG o PNG")
        # La firma binaria real debe coincidir con el tipo declarado: el
        # Content-Type que manda el cliente no prueba nada sobre el
        # contenido real (mismo criterio que `actualizar_foto_perfil`).
        if not es_firma_valida(contenido, content_type):
            raise OperacionInvalida(
                "El contenido del archivo no coincide con el formato declarado"
            )
        # Defensa en profundidad: el router ya acota la lectura vía
        # `leer_con_limite` antes de llegar acá.
        if len(contenido) > AuthServicio.TAMANO_MAXIMO_FOTO_PERFIL_BYTES:
            raise OperacionInvalida("El archivo excede el tamaño máximo de 5MB")

        from app.infraestructura.cloudinary_cliente import (
            componer_valor_foto_perfil,
            subir_foto_perfil,
        )

        public_id = f"perfil_{persona.id}"
        # Issue #553 (Problema 2): se persiste el `public_id`, nunca la URL que
        # devuelve el SDK (`type="authenticated"`); la URL firmada se resuelve al
        # serializar la respuesta (`PersonaResponseDTO`, mismo patrón voucher).
        # Issue #662: se compone además el `version` de ESTA subida -- mismo
        # criterio que `AuthServicio.actualizar_foto_perfil`, ver su comentario.
        version = subir_foto_perfil(
            contenido=contenido,
            nombre_publico=public_id,
            content_type=content_type,
            persona_id=persona.id,
        )
        return self.repo.actualizar(
            persona, {"foto_url": componer_valor_foto_perfil(public_id, version)},
        )


    # --- Baja lógica (reemplaza el borrado duro) --------------------------
    def cambiar_estado(self, persona_id: int, activo: bool) -> Persona:
        """Da de baja o reincorpora a una persona SIN borrar nada.

        Reemplaza al viejo `eliminar_persona`, que hacía un DELETE real y se
        llevaba puesto el historial de asistencias, los pagos y la ficha
        médica del ex-miembro.

        Dos reglas que no son negociables:

        1. Dar de baja a una persona TAMBIÉN desactiva su `Usuario`, si lo
           tiene: quien ya no es miembro no puede seguir entrando al sistema.
           Reusa la misma barrera anti-bloqueo de `RolServicio` para no dejar
           al club sin ningún administrador activo por esta puerta lateral.
        2. Reincorporarla NO reactiva la cuenta. El estado de la CUENTA es una
           preocupación separada del estado de MEMBRESÍA (una cuenta puede
           estar suspendida por razones propias: contraseña comprometida,
           sanción). Devolver el acceso es una decisión explícita y aparte,
           vía `PATCH /personas/{id}/cuenta/estado`.

        Idempotente: aplicar el mismo estado dos veces no es un error.
        """
        persona = self.obtener_persona(persona_id)
        usuario = self.repo_usuario.obtener_por_persona_id(persona_id)

        if not activo and usuario is not None:
            # Import local: `RolServicio` ya importa este módulo indirectamente
            # a través de los repositorios; hacerlo arriba crearía un ciclo.
            from app.servicios_negocio.rol_servicio import RolServicio
            RolServicio(self.db)._asegurar_que_queda_otro_administrador(
                usuario, "dar de baja a esta persona"
            )
            usuario.activo = False
            # Criterio unificado (issue #4): la baja lógica RETIRA acceso
            # (desactiva el `Usuario`), así que también invalida sus sesiones
            # activas. Reincorporar no reactiva la cuenta (regla 2 de arriba)
            # y por lo tanto tampoco bombea nada.
            usuario.revocar_sesiones()

        return self.repo.actualizar(persona, {"activo": activo})

    def independizar(self, persona_id: int, datos: IndependizarDTO) -> Persona:
        """Permite a un ex-menor (mayor de edad) independizarse de su
        representante legal. Validaciones:
        1. La persona debe existir y tener representante_id.
        2. Debe ser mayor de edad (>= 18).
        3. La contraseña proporcionada debe coincidir con la del Usuario.
        4. No debe tener deudas pendientes (membresías sin pago o pagos
           pendientes de validación).

        Resultado: representante_id = None. El rol NO cambia.

        Issue #762: acá se asignaba además el rol REPRESENTANTE. Como quien
        se independiza es siempre un ex-menor con rol ALUMNO, esa línea era
        una fábrica garantizada de cuentas ALUMNO+REPRESENTANTE -- el único
        camino de los cinco que producía el segundo rol en el 100% de los
        casos. Se quita, y no se reemplaza por un rechazo, porque lo que
        independiza a la persona es cortar el VÍNCULO (`representante_id =
        None`), no el rol: la autorización de representación se resuelve por
        ese vínculo (`PoliticaAcceso.puede_acceder`), y el rol REPRESENTANTE
        solo habilita "agregar/vincular dependiente", que un recién
        independizado no tiene. Si más adelante llega a representar a
        alguien, el rol se le asigna como una decisión explícita desde el
        panel de administración."""
        persona = self.obtener_persona(persona_id)

        if not persona.representante_id:
            raise OperacionInvalida("Esta persona no tiene un representante legal asociado.")

        edad = _calcular_edad(persona.fecha_nacimiento)
        if edad < EDAD_MAYORIA_EDAD:
            raise OperacionInvalida(
                f"La persona debe ser mayor de edad ({EDAD_MAYORIA_EDAD}+ años) "
                f"para independizarse (calculado: {edad})."
            )

        usuario = self.repo_usuario.obtener_por_persona_id(persona_id)
        if not usuario:
            raise EntidadNoEncontrada("Esta persona no tiene una cuenta de usuario activa.")
        if not GestorAutenticacion.verificar_contrasenia(datos.contrasenia, usuario.contrasenia):
            raise EntidadDuplicada("La contraseña proporcionada es incorrecta.")

        if MembresiaRepositorio(self.db).tiene_deudas_pendientes(persona_id):
            raise OperacionInvalida(
                "No es posible independizarse: existen membresías o pagos pendientes. "
                "Regularice su situación antes de continuar."
            )

        persona.representante_id = None
        self.repo.actualizar(persona, {"representante_id": None})

        return persona

    # --- Reportes (E04-RF014) --------------------------------------------------
    def reporte_nuevos_por_periodo(self, fecha_inicio, fecha_fin) -> list[Persona]:
        return self.repo.listar_nuevas_por_periodo(fecha_inicio, fecha_fin)

    def buscar_por_nombre(
        self, q: str, rol: str | None = None, skip: int = 0, limit: int = 20
    ) -> list[Persona]:
        if len(q.strip()) < 2:
            raise OperacionInvalida("La búsqueda requiere al menos 2 caracteres.")
        return self.repo.buscar_por_nombre(q=q.strip(), rol=rol, skip=skip, limit=limit)
