"""Orquestación de los comandos de representación (#1137).

Este servicio es el ÚNICO dueño de las escrituras de `representante_id` en
el flujo de cuenta: `PersonaServicio` delega acá y los routers no tocan la
columna. PR 3 entrega el primer comando del contrato del diseño:

  - `independizar_presencial`: salida de independencia de un adulto,
    ejecutada SOLO por un administrador con la persona enfrente.
  - `reasignar_presencial`: reemplazo administrativo del vínculo de un menor,
    ejecutado SOLO por un administrador con la persona enfrente (PR 4c1).

`crear_desde_sesion` llega con su propio slice; no se anticipa acá.

Transacción: UN solo `commit()` por comando, después de credenciales,
capacidad #762, remoción del vínculo, auditoría completa y epochs de
sesión. Cualquier falla antes del commit revierte TODO -- el vínculo
original queda usable y no queda evidencia a medias. La notificación al ex
representante corre DESPUÉS del commit, en una transacción propia y con
esfuerzo best-effort: su fallo no revierte ni invalida el éxito ya
comiteado, y jamás se persiste fuera del canal existente (sin outbox de
relación, sin estado de solicitud, sin segunda proyección del vínculo).
"""
import hashlib
import logging

from sqlalchemy.orm import Session

from app.dominio.enums import TipoNotificacion
from app.dominio.excepciones import (
    ConflictoConcurrencia, EntidadNoEncontrada, OperacionInvalida,
)
from app.dominio.modelos import Notificacion, Persona, Usuario
from app.dominio.reglas_negocio import EDAD_MAYORIA_EDAD, calcular_edad
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.infraestructura.repositorios.vinculacion_representante_repositorio import (
    VinculacionRepresentanteRepositorio,
)
from app.dominio.representados_alcanzables import (
    exigir_representante_destino_alcanzable,
    exigir_telefono_actual_del_destino,
)
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.rol_servicio import RolServicio
from app.soporte_transversal.tiempo import hoy_club

_log = logging.getLogger(__name__)

# Versión del comando dentro de la huella: cambiar la semántica del comando
# invalida las huellas viejas a propósito (una clave vieja con comando nuevo
# es un conflicto 409, no un replay silencioso).
_VERSION_COMANDO_INDEPENDENCIA = "independencia-presencial:v1"

# Misma política para la reasignación: la identidad del comando es a quién,
# desde qué vínculo observado y hacia qué destino. La evidencia de identidad NO
# entra: es la constancia del trámite, no la identidad del comando.
_VERSION_COMANDO_REASIGNACION = "reasignacion-presencial:v1"


def _huella_independencia(persona_id: int, correo: str, admin_actor_id: int) -> str:
    """SHA-256 canónico del comando: persona destino, correo normalizado y
    actor. La contraseña NO entra a propósito: es una credencial que el
    administrador teclea de nuevo en cada reintento y su variación no cambia
    la IDENTIDAD del comando -- la identidad es a quién y con qué correo."""
    canonico = (
        f"{_VERSION_COMANDO_INDEPENDENCIA}"
        f"|persona_id={persona_id}"
        f"|correo={correo.strip().lower()}"
        f"|actor={admin_actor_id}"
    )
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


def _huella_reasignacion(
    persona_id: int, representante_actual_id: int | None,
    nuevo_representante_id: int, admin_actor_id: int,
) -> str:
    """SHA-256 canónico del comando de reasignación: persona destino, el
    vínculo OBSERVADO por el administrador, el destino nuevo y el actor."""
    canonico = (
        f"{_VERSION_COMANDO_REASIGNACION}"
        f"|persona_id={persona_id}"
        f"|representante_actual_id={representante_actual_id}"
        f"|representante_nuevo_id={nuevo_representante_id}"
        f"|actor={admin_actor_id}"
    )
    return hashlib.sha256(canonico.encode("utf-8")).hexdigest()


class RelacionRepresentacionServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo_persona = PersonaRepositorio(db)
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_ledger = VinculacionRepresentanteRepositorio(db)

    # --- PR 3: independencia presencial (solo ADMINISTRADOR) -----------------

    def independizar_presencial(
        self, *, admin_actor_id: int, persona_id: int, comando, idempotency_key: str | None,
    ) -> dict:
        """Convierte a un adulto representado en persona independiente.

        Establece credenciales verificadas y la única capacidad
        REPRESENTANTE sobre el `persona_id` SIN CAMBIAR, corta el vínculo
        con su representante, deja la evidencia completa en el ledger y
        revoca los epochs afectados -- todo en UNA transacción. La deuda no
        se lee (la independencia no la negocia); un menor se rechaza; el
        reintento con la misma clave devuelve el resultado establecido."""
        if not idempotency_key or not idempotency_key.strip():
            raise OperacionInvalida(
                "El comando requiere la cabecera Idempotency-Key: identifica el "
                "intento y hace que un reintento devuelva el resultado ya "
                "establecido en lugar de duplicar nada."
            )
        idempotency_key = idempotency_key.strip()

        huella = _huella_independencia(persona_id, comando.correo, admin_actor_id)

        # Replay PRIMERO, antes de validar: un comando que ya comiteó se
        # responde desde su evidencia, aunque el mundo haya cambiado desde
        # entonces (el vínculo ya está cortado: revalidarlo fallaría).
        previo = self.repo_ledger.obtener_por_clave(idempotency_key)
        if previo is not None:
            if previo.request_fingerprint != huella:
                raise ConflictoConcurrencia(
                    "La clave de idempotencia ya fue usada por otro comando. "
                    "Genere una clave nueva para este intento.",
                    detalle_tecnico=(
                        f"clave={idempotency_key} registrada con huella distinta "
                        f"(evento_id={previo.id})"
                    ),
                )
            return {
                "persona_id": previo.persona_id,
                "representante_anterior_id": previo.representante_anterior_id,
                "usuario_id": None,
                "cuenta_creada": False,
                "replay": True,
                "idempotency_key": idempotency_key,
            }

        try:
            resultado = self._ejecutar_independencia(
                admin_actor_id=admin_actor_id, persona_id=persona_id,
                comando=comando, idempotency_key=idempotency_key, huella=huella,
            )
        except Exception:
            self.db.rollback()
            raise

        # Post-commit, transacción aparte, best-effort: si el canal falla,
        # la independencia YA comiteó y el comando la devuelve igual.
        self._notificar_ex_representante(
            representante_anterior_id=resultado["representante_anterior_id"],
            evento_id=resultado["evento_id"],
        )
        return {clave: valor for clave, valor in resultado.items() if clave != "evento_id"}

    def _ejecutar_independencia(
        self, *, admin_actor_id: int, persona_id: int, comando, idempotency_key: str,
        huella: str,
    ) -> dict:
        # 1. Bloquear la fila del target: la decisión es sobre ESTA persona.
        persona = self._bloquear_persona(persona_id)
        if persona is None:
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")

        # 2. Validaciones de remoción: vínculo vivo y adulto HOY (la edad la
        #    calcula el día del club; el trigger g1139 de la base es el
        #    respaldo contra cualquier bypass).
        if not persona.representante_id:
            raise OperacionInvalida(
                "Esta persona no tiene un representante legal asociado."
            )
        edad = calcular_edad(persona.fecha_nacimiento, hoy_club())
        if edad < EDAD_MAYORIA_EDAD:
            raise OperacionInvalida(
                f"La persona debe ser mayor de edad ({EDAD_MAYORIA_EDAD}+ años) "
                f"para independizarse (calculado: {edad}). Un menor no se "
                "desvincula: corresponde una reasignación administrativa."
            )
        representante_anterior_id = persona.representante_id

        # 3. Bloquear al ex representante y las dos cuentas en orden estable.
        # Lock del ex representante: la fila queda bloqueada aunque este
        # método no lea nada más de ella (el epoch se escribe vía repo).
        self._bloquear_persona(representante_anterior_id)
        self._bloquear_usuarios([persona_id, representante_anterior_id])

        # 4. Credenciales verificadas sobre el MISMO persona_id (puede fallar
        #    por correo ajeno: ese fallo revierte todo ANTES de tocar nada).
        #    Instanciación directa (`Clase(...).metodo`): además de ser la
        #    forma que el candado del event loop sabe resolver hasta bcrypt,
        #    deja explícito qué núcleo hace qué.
        cuenta_preexistente = (
            self.repo_usuario.obtener_por_persona_id(persona.id) is not None
        )
        usuario = AuthServicio(self.db).establecer_credenciales_persona_existente(
            persona, comando.correo, comando.contrasenia,
        )

        # 5. Capacidad #762: insertar, reusar o reemplazar explícitamente.
        RolServicio(self.db).establecer_capacidad_representante(usuario)

        # 6. Cortar el vínculo.
        self.repo_persona.actualizar(persona, {"representante_id": None})

        # 7. Epochs: el ex representante pierde acceso a la ficha al instante;
        #    la cuenta legada del adulto también se revoca (cambiaron
        #    credenciales y rol). Una cuenta recién creada no tiene token
        #    previo que revocar.
        usuario_viejo = self.repo_usuario.obtener_por_persona_id(representante_anterior_id)
        if usuario_viejo is not None:
            usuario_viejo.revocar_sesiones()
        if cuenta_preexistente:
            usuario.revocar_sesiones()

        # 8. Evidencia completa, con la clave como recibo de replay.
        evento = self.repo_ledger.registrar(
            persona_id=persona_id,
            actor_persona_id=admin_actor_id,
            representante_anterior_id=representante_anterior_id,
            representante_nuevo_id=None,
            operacion="INDEPENDENCIA",
            origen="ADMIN_PRESENCIAL",
            idempotency_key=idempotency_key,
            request_fingerprint=huella,
        )

        # 9. El ÚNICO commit del comando. Nada de tokens: quien ejecuta es el
        #    administrador; el adulto entra después por el login normal.
        self.db.commit()

        return {
            "persona_id": persona_id,
            "representante_anterior_id": representante_anterior_id,
            "usuario_id": usuario.id,
            "cuenta_creada": not cuenta_preexistente,
            "replay": False,
            "idempotency_key": idempotency_key,
            "evento_id": evento.id,
        }

    # --- PR 4: reasignación presencial (solo ADMINISTRADOR) -------------------

    def reasignar_presencial(
        self, *, admin_actor_id: int, persona_id: int, comando, idempotency_key: str | None,
    ) -> dict:
        """Reemplaza al representante actual de un menor en UNA transacción.

        El administrador OBSERVÓ `comando.representante_actual_id` al abrir el
        trámite: si el vínculo cambió mientras tanto, el comando conflictúa
        (409) en vez de pisar el cambio ajeno. `validar_enlace` decide sobre las
        filas YA BLOQUEADAS (objetivo primero, luego ex/nuevo y cuentas en
        ascendente por `persona.id`), el ledger deja la evidencia completa
        REASIGNACION/ADMIN_PRESENCIAL, el epoch sube SOLO para el ex
        representante y el aviso al ex corre post-commit por el canal existente.
        Un reintento con la misma clave+huella devuelve el resultado establecido."""
        if not idempotency_key or not idempotency_key.strip():
            raise OperacionInvalida(
                "El comando requiere la cabecera Idempotency-Key: identifica el "
                "intento y hace que un reintento devuelva el resultado ya "
                "establecido en lugar de duplicar nada."
            )
        idempotency_key = idempotency_key.strip()

        huella = _huella_reasignacion(
            persona_id, comando.representante_actual_id,
            comando.nuevo_representante_id, admin_actor_id,
        )

        # Replay PRIMERO, antes de validar: un comando que ya comiteó se responde
        # desde su evidencia, aunque el mundo haya cambiado desde entonces (el
        # vínculo ya apunta al destino nuevo: revalidarlo fallaría).
        previo = self.repo_ledger.obtener_por_clave(idempotency_key)
        if previo is not None:
            if previo.request_fingerprint != huella:
                raise ConflictoConcurrencia(
                    "La clave de idempotencia ya fue usada por otro comando. "
                    "Genere una clave nueva para este intento.",
                    detalle_tecnico=(
                        f"clave={idempotency_key} registrada con huella distinta "
                        f"(evento_id={previo.id})"
                    ),
                )
            return {
                "persona_id": previo.persona_id,
                "representante_anterior_id": previo.representante_anterior_id,
                "representante_nuevo_id": previo.representante_nuevo_id,
                "replay": True,
                "idempotency_key": idempotency_key,
            }

        try:
            resultado = self._ejecutar_reasignacion(
                admin_actor_id=admin_actor_id, persona_id=persona_id,
                comando=comando, idempotency_key=idempotency_key, huella=huella,
            )
        except Exception:
            self.db.rollback()
            raise

        # Post-commit, transacción aparte, best-effort: si el canal falla, la
        # reasignación YA comiteó y el comando la devuelve igual.
        self._notificar_ex_representante(
            representante_anterior_id=resultado["representante_anterior_id"],
            evento_id=resultado["evento_id"],
        )
        return {clave: valor for clave, valor in resultado.items() if clave != "evento_id"}

    def _ejecutar_reasignacion(
        self, *, admin_actor_id: int, persona_id: int, comando, idempotency_key: str,
        huella: str,
    ) -> dict:
        # 1. Locks deterministas en UN solo orden ascendente por `persona.id`:
        #    objetivo, ex y nuevo. El estado observado viene en el comando, así
        #    que el conjunto de locks se conoce SIN leer antes de bloquear (el
        #    orden fijo evita el abrazo entre comandos concurrentes).
        ids = sorted({
            persona_id,
            comando.representante_actual_id,
            comando.nuevo_representante_id,
        })
        bloqueadas: dict[int, Persona | None] = {}
        for pid in ids:
            bloqueadas[pid] = self.repo_persona.obtener_por_id_bloqueando(pid)

        persona = bloqueadas.get(persona_id)
        if persona is None:
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")

        # 2. Conflicto por estado OBSERVADO obsoleto: si otro comando ya cambió
        #    el vínculo desde que el administrador lo leyó, este NO lo pisa.
        if persona.representante_id != comando.representante_actual_id:
            raise ConflictoConcurrencia(
                "El vínculo de representación cambió desde que se abrió el "
                "trámite: recargue la ficha y reintente.",
                detalle_tecnico=(
                    f"persona_id={persona_id} observado="
                    f"{comando.representante_actual_id} "
                    f"actual={persona.representante_id}"
                ),
            )
        representante_anterior_id = persona.representante_id

        destino = bloqueadas.get(comando.nuevo_representante_id)
        if destino is None:
            raise EntidadNoEncontrada(
                f"Persona con id {comando.nuevo_representante_id} no encontrada"
            )

        # Las cuentas relevantes en ese mismo orden ascendente.
        self._bloquear_usuarios([
            pid for pid in (persona_id, representante_anterior_id,
                            comando.nuevo_representante_id)
            if pid is not None
        ])
        cuenta_destino = self.repo_usuario.obtener_por_persona_id(destino.id)

        # 4. Los invariantes compartidos (PR 4b) deciden sobre filas bloqueadas.
        self.validar_enlace(
            objetivo=persona, destino=destino,
            enlace_actual=representante_anterior_id, cuenta_destino=cuenta_destino,
        )

        # 5. Reemplazo atómico, epoch del EX representante (el destino recibe
        #    acceso por el vínculo recién comiteado: no hay token previo que
        #    revocar) y evidencia con la clave como recibo de replay.
        self.repo_persona.actualizar(persona, {"representante_id": destino.id})

        usuario_viejo = (
            self.repo_usuario.obtener_por_persona_id(representante_anterior_id)
            if representante_anterior_id is not None else None
        )
        if usuario_viejo is not None:
            usuario_viejo.revocar_sesiones()

        evento = self.repo_ledger.registrar(
            persona_id=persona_id,
            actor_persona_id=admin_actor_id,
            representante_anterior_id=representante_anterior_id,
            representante_nuevo_id=destino.id,
            operacion="REASIGNACION",
            origen="ADMIN_PRESENCIAL",
            idempotency_key=idempotency_key,
            request_fingerprint=huella,
        )

        # 6. El ÚNICO commit del comando.
        self.db.commit()

        return {
            "persona_id": persona_id,
            "representante_anterior_id": representante_anterior_id,
            "representante_nuevo_id": destino.id,
            "replay": False,
            "idempotency_key": idempotency_key,
            "evento_id": evento.id,
        }

    # --- PR 4: validador compartido de la relación (#1133) -------------------

    def validar_enlace(
        self, *, objetivo: Persona, destino: Persona, enlace_actual: int | None,
        cuenta_destino: Usuario | None = None,
    ) -> None:
        """Los invariantes de TODO vínculo, en el orden del diseño:
        sin-cambio → self → edad del objetivo → destino elegible, alcanzable
        y con teléfono → ciclo. Es el ÚNICO dueño de estas reglas: crear,
        reasignar y todo comando futuro pasan por acá. La base es la
        garantía final contra bypasseos (trigger `i1141relinteg`); el fallo
        de servicio es el camino legible y accionable.

        Recibe las filas YA BLOQUEADAS: quien arma la transacción garantiza
        el orden de locks; acá solo se lee estado bajo ese lock."""
        if destino is None:
            raise EntidadNoEncontrada("La persona destino del vínculo no existe")

        if enlace_actual is not None and destino.id == enlace_actual:
            raise OperacionInvalida(
                "La persona ya es su representante actual: el comando no "
                "tendría ningún cambio."
            )

        if destino.id == objetivo.id:
            raise OperacionInvalida(
                "Una persona no puede ser su propio representante."
            )

        edad_objetivo = calcular_edad(objetivo.fecha_nacimiento, hoy_club())
        if edad_objetivo >= EDAD_MAYORIA_EDAD:
            raise OperacionInvalida(
                f"Solo se vincula a menores de edad: la persona tiene "
                f"{edad_objetivo} años. Un adulto no se vincula ni se "
                "re-enlaza; le corresponde independencia (si ya estaba "
                "vinculada) o ninguna relación."
            )

        if not destino.activo:
            raise OperacionInvalida(
                "La persona destino está dada de baja y no puede recibir "
                "representados.",
                detalle_tecnico=f"persona destino_id={destino.id} activo=False",
            )

        edad_destino = calcular_edad(destino.fecha_nacimiento, hoy_club())
        if edad_destino < EDAD_MAYORIA_EDAD:
            raise OperacionInvalida(
                f"El representante debe ser mayor de edad "
                f"({EDAD_MAYORIA_EDAD}+ años); el destino tiene "
                f"{edad_destino}."
            )

        exigir_representante_destino_alcanzable(destino.id, cuenta_destino)
        exigir_telefono_actual_del_destino(destino.id, destino.telefono)

        if self._hay_ciclo(destino_id=destino.id, objetivo_id=objetivo.id):
            raise OperacionInvalida(
                "El vínculo formaría un ciclo de representación: la persona "
                "destino ya desciende de la persona a vincular."
            )

    def _hay_ciclo(self, *, destino_id: int, objetivo_id: int,
                   tope: int = 64) -> bool:
        """Sube por `representante_id` desde el destino: si la cadena llega
        al objetivo, el vínculo nuevo cierra un ciclo. El tope convierte una
        cadena absurda (imposible bajo el trigger) en rechazo defensivo."""
        actual = destino_id
        for _ in range(tope):
            fila = (
                self.db.query(Persona.representante_id)
                .filter(Persona.id == actual)
                .one_or_none()
            )
            if fila is None or fila[0] is None:
                return False
            actual = fila[0]
            if actual == objetivo_id:
                return True
        return True

    # --- Helpers de bloqueo ---------------------------------------------------

    def _bloquear_persona(self, persona_id: int) -> Persona | None:
        return (
            self.db.query(Persona)
            .filter(Persona.id == persona_id)
            .with_for_update()
            .first()
        )

    def _bloquear_usuarios(self, persona_ids: list[int]) -> None:
        """`SELECT ... FOR UPDATE` de las cuentas por `persona_id`, en orden
        ascendente: el orden fijo evita el abrazo de dos comandos que
        bloquean las mismas filas en orden contrario."""
        if not persona_ids:
            return
        self.db.query(Usuario).filter(
            Usuario.persona_id.in_(sorted(set(persona_ids)))
        ).with_for_update().all()

    # --- Post-commit: canal existente, best-effort ----------------------------

    def _notificar_ex_representante(
        self, *, representante_anterior_id: int | None, evento_id: int,
    ) -> None:
        """Avisa al ex representante DESPUÉS del commit, en una transacción
        propia (segundo `commit()` de la misma sesión). El fallo se registra
        estructurado y NO propaga: la operación de representación ya está
        comiteada y un aviso fallido no la revierte ni la invalida. Sin outbox: la fila de
        `Notificacion` es el canal existente y no se agrega ningún ciclo de
        vida de notificación de relación."""
        if representante_anterior_id is None:
            return
        try:
            self.db.add(Notificacion(
                persona_id=representante_anterior_id,
                tipo=TipoNotificacion.VINCULACION_REPRESENTANTE,
                mensaje=(
                    "La administración del club finalizó el vínculo de "
                    "representación de una persona que figuraba bajo tu cuenta. "
                    "Tu sesión quedó cerrada por seguridad."
                ),
                entidad_relacionada_id=evento_id,
            ))
            self.db.commit()
        except Exception:
            self.db.rollback()
            _log.exception(
                "No se pudo notificar la operación de representación "
                "operacion_id=%s destinatario_persona_id=%s",
                evento_id, representante_anterior_id,
            )
