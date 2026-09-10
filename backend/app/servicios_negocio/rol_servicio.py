from sqlalchemy.orm import Session

from app.dominio.modelos import Usuario
from app.dominio.enums import TipoRol
from app.dominio.etiquetas import rol_en_castellano
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.dominio.representados_alcanzables import exigir_sin_representados_menores_activos
from app.dominio.rol_unico import exigir_rol_unico
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.soporte_transversal.tiempo import hoy_club


class RolServicio:
    """
    Cierra un gap real: NO existía en ningún lado del backend un endpoint
    para asignar un `TipoRol` a un `Usuario`. `POST /auth/registro` crea
    las credenciales sin roles ("se asignan por separado", decía el
    comentario) pero ese "por separado" nunca se construyó -- sin esto,
    ningún usuario podía pasar un `GestorPermisos` jamás.

    Este servicio maneja ALUMNO / ENTRENADOR / ADMINISTRADOR /
    REPRESENTANTE. El rol REPRESENTANTE se asigna automáticamente al
    representante legal durante la autoinscripción (enrollment_servicio),
    no mediante este endpoint admin.
    """

    def __init__(self, db: Session):
        self.db = db
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        self.repo_rol = RolRepositorio(db)

    def _obtener_usuario_de_persona(self, persona_id: int) -> Usuario:
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")
        usuario = self.repo_usuario.obtener_por_persona_id(persona_id)
        if not usuario:
            raise OperacionInvalida(
                "Esta persona todavía no creó su usuario y contraseña; no se le "
                "puede asignar un rol hasta que lo haga.",
                detalle_tecnico="sin Usuario asociado; se crea con POST /auth/registro",
            )
        return usuario

    def obtener_roles(self, persona_id: int) -> Usuario:
        """Lectura pura: no muta nada, solo expone el estado actual de
        roles/activo. Usado por `GET /personas/{id}/roles` para que el
        frontend pueda pre-cargar el estado real antes de mostrar
        toggles/checkboxes (evita que el modal de edición asuma "sin
        roles" / "activo" por defecto)."""
        return self._obtener_usuario_de_persona(persona_id)

    def asignar_rol(self, persona_id: int, tipo_rol: TipoRol) -> Usuario:
        usuario = self._obtener_usuario_de_persona(persona_id)
        if any(r.tipo_rol == tipo_rol for r in usuario.roles):
            raise OperacionInvalida(
                f"Esta persona ya tiene el rol de {rol_en_castellano(tipo_rol)}.",
                detalle_tecnico=f"tipo_rol={tipo_rol.value} ya asignado",
            )
        # Issue #762. El duplicado del MISMO rol se contesta arriba porque
        # dice otra cosa ("ya lo tiene") y esa frase es la que el modal de
        # roles usa para reconciliar su checkbox; acá cae solo el rol
        # DISTINTO, que es el que se rechaza en vez de reemplazar.
        exigir_rol_unico(usuario, tipo_rol)
        rol = self.repo_rol.obtener_o_crear(tipo_rol)
        usuario.roles.append(rol)
        self.db.commit()
        self.db.refresh(usuario)
        return usuario

    # --- Barrera anti-bloqueo de administradores ---------------------------
    # Quitar el rol ADMINISTRADOR (o desactivar la cuenta) del último
    # administrador activo deja al club sin ninguna vía de recuperación dentro
    # de la aplicación: no existe un comando de rescate ni una cuenta de
    # respaldo. Por eso ambas operaciones se validan contra el mismo conteo.
    def _asegurar_que_queda_otro_administrador(self, usuario: Usuario, accion: str) -> None:
        es_admin = any(r.tipo_rol == TipoRol.ADMINISTRADOR for r in usuario.roles)
        if not es_admin:
            return
        # Serialización del conteo (issue #8): sin lock, dos operaciones
        # concurrentes sobre los dos últimos administradores (quitar rol a
        # uno + desactivar al otro) veían cada una que "queda otro" y el club
        # terminaba sin ningún administrador. La fila del catálogo
        # ADMINISTRADOR actúa como mutex (ver docstring de
        # `RolRepositorio.bloquear_por_tipo`): la segunda operación espera el
        # commit de la primera y su conteo ya ve el cambio. Si el usuario es
        # admin, la fila del catálogo existe por construcción.
        self.repo_rol.bloquear_por_tipo(TipoRol.ADMINISTRADOR)
        if self.repo_usuario.contar_administradores_activos(excluir_usuario_id=usuario.id) > 0:
            return
        raise OperacionInvalida(
            f"No se puede {accion}: es el último administrador activo del "
            "sistema y quedaría sin acceso de administración. Asigne ese rol "
            "a otra cuenta activa antes de continuar.",
            detalle_tecnico=(
                f"contar_administradores_activos(excluir={usuario.id}) == 0"
            ),
        )

    def _asegurar_que_no_se_quita_a_si_mismo(
        self, usuario: Usuario, persona_id_solicitante: int | None
    ) -> None:
        if persona_id_solicitante is None:
            return
        if usuario.persona_id != persona_id_solicitante:
            return
        raise OperacionInvalida(
            "No puede quitarse a sí mismo el rol de administrador: perdería el "
            "acceso de administración de inmediato. Pídale a otro "
            "administrador que lo haga.",
            detalle_tecnico=f"solicitante persona_id={persona_id_solicitante} es el titular",
        )

    def quitar_rol(
        self,
        persona_id: int,
        tipo_rol: TipoRol,
        persona_id_solicitante: int | None = None,
    ) -> Usuario:
        usuario = self._obtener_usuario_de_persona(persona_id)
        rol = next((r for r in usuario.roles if r.tipo_rol == tipo_rol), None)
        if not rol:
            # OperacionInvalida (400), no EntidadNoEncontrada (404): la persona
            # existe y el rol del catálogo existe; lo que no se puede es quitar
            # un rol que no está asignado. El 404 además hacía inalcanzable el
            # mensaje: el frontend solo confía en el `detail` de 400/409/422
            # (ver frontend/src/lib/error-message.ts), así que el modal de
            # roles perdía la frase con la que reconcilia su checkbox.
            raise OperacionInvalida(
                f"Esta persona no tiene el rol de {rol_en_castellano(tipo_rol)}.",
                detalle_tecnico=f"tipo_rol={tipo_rol.value} no está asignado",
            )
        if tipo_rol == TipoRol.ADMINISTRADOR:
            self._asegurar_que_no_se_quita_a_si_mismo(usuario, persona_id_solicitante)
            self._asegurar_que_queda_otro_administrador(usuario, "quitar el rol de administrador")
        usuario.roles.remove(rol)
        # Criterio unificado (issue #4): el access token lleva los roles
        # embebidos, así que un token emitido antes de esta operación conserva
        # el rol quitado hasta su expiración natural. Bombear el epoch cierra
        # esa ventana de inmediato.
        usuario.revocar_sesiones()
        self.db.commit()
        self.db.refresh(usuario)
        return usuario

    # --- Capacidad REPRESENTANTE (#1137, regla compartida #762) -------------
    def establecer_capacidad_representante(self, usuario: Usuario) -> bool:
        """Deja en `usuario` EXACTAMENTE un rol: REPRESENTANTE.

        Es el núcleo de capacidad compartido de los caminos de cuenta: lo
        invocan los comandos presenciales (y, más adelante, el alta de
        cuenta de representante). La regla #762 se aplica de forma
        determinista sobre las filas del usuario YA BLOQUEADAS:

          1. multirol legado (debería ser imposible: el trigger
             `trg_usuario_rol_unico_por_usuario` lo impide en la base) →
             se RECHAZA para que lo remedie su dueño; jamás se adivina ni
             se reescribe en silencio;
          2. ya es REPRESENTANTE → se reusa, sin segunda inserción;
          3. un único rol legal distinto → reemplazo EXPLÍCITO (quitar ese
             rol y asignar REPRESENTANTE) -- solo existe en el comando
             presencial autorizado por administración, nunca como
             conversión genérica de roles;
          4. sin roles → se inserta REPRESENTANTE (nunca ALUMNO: la
             capacidad de representante no crea jugador).

        No escribe columnas de relación y no comitea (solo `flush()`): la
        transacción la cierra el comando. Devuelve `True` si la colección
        cambió, `False` si se reusó."""
        tipos_actuales = [rol.tipo_rol for rol in usuario.roles]
        if len(tipos_actuales) > 1:
            raise OperacionInvalida(
                "Esta cuenta tiene más de un rol activo (estado legado) y la "
                "capacidad de representante no se puede establecer "
                "automáticamente: requiere que su dueño elija qué rol "
                "conserva.",
                detalle_tecnico=(
                    f"usuario_id={usuario.id} tiene "
                    f"{sorted(tipo.value for tipo in tipos_actuales)}"
                ),
            )
        if TipoRol.REPRESENTANTE in tipos_actuales:
            return False
        if tipos_actuales:
            # Reemplazo explícito del ÚNICO rol legal. Quitar y asignar son
            # dos escrituras de la misma transacción: el trigger #762 ve la
            # asociación vieja ya borrada cuando inserta la nueva.
            usuario.roles.remove(usuario.roles[0])
            self.db.flush()
        rol = self.repo_rol.obtener_o_crear(TipoRol.REPRESENTANTE)
        usuario.roles.append(rol)
        self.db.flush()
        return True

    def asignar_alumno_si_corresponde(self, persona_id: int) -> None:
        """
        Asignación perezosa (principio de diseño ya acordado: el rol ALUMNO
        se otorga al matricularse, no al crear la cuenta). Se llama desde
        MembresiaServicio.crear_membresia. Es un "mejor esfuerzo": si la
        persona todavía no tiene Usuario (no se ha auto-registrado), no hace
        nada -- no es un error, simplemente no hay nada que asignar todavía.

        Solo `flush()` (issue #831): es un paso de la transacción atómica de
        `crear_membresia`, que hace el único `commit()` al final -- antes
        comiteaba acá, ANTES de que `crear_membresia` terminara de escribir.
        """
        usuario = self.repo_usuario.obtener_por_persona_id(persona_id)
        if not usuario:
            return None
        # Issue #762: "mejor esfuerzo" nunca quiso decir "y si ya tiene otro
        # rol, se lo sumo igual". Este era el camino más silencioso de los
        # cuatro -- matricular a un entrenador le agregaba ALUMNO sin que
        # nadie lo pidiera ni lo viera.
        if not exigir_rol_unico(usuario, TipoRol.ALUMNO):
            return None
        rol_alumno = self.repo_rol.obtener_o_crear(TipoRol.ALUMNO)
        usuario.roles.append(rol_alumno)
        self.db.flush()

    def exigir_que_pueda_ser_alumno(self, persona_id: int) -> None:
        """La mitad de `asignar_alumno_si_corresponde` que NO muta, para que
        `MembresiaServicio.crear_membresia` pueda rechazar ANTES de escribir.

        Sin esto el rechazo llegaría al final del método, con la membresía ya
        comiteada: la persona quedaría matriculada y el request devolvería un
        error, que es el peor de los dos mundos."""
        usuario = self.repo_usuario.obtener_por_persona_id(persona_id)
        if usuario is None:
            return
        exigir_rol_unico(usuario, TipoRol.ALUMNO)

    # --- E01-RF013: activar/desactivar cuenta sin borrar datos -------------
    def cambiar_estado_cuenta(self, persona_id: int, activo: bool) -> Usuario:
        usuario = self._obtener_usuario_de_persona(persona_id)
        if not activo:
            self._asegurar_que_queda_otro_administrador(usuario, "desactivar esta cuenta")
            # Issue #1139: desactivar esta cuenta no puede dejar a un menor
            # representado sin nadie que pueda acceder a su ficha.
            exigir_sin_representados_menores_activos(
                persona_id, self.repo_persona.listar_representados(persona_id),
                hoy_club(), "desactivar esta cuenta",
            )
            # Criterio unificado (issue #4): desactivar RETIRA acceso, así que
            # además del flag se invalidan las sesiones activas. Reactivar NO
            # bombea: devolver el acceso no invalida nada (y los tokens
            # previos a la desactivación quedan muertos por el bump anterior).
            usuario.revocar_sesiones()
        usuario.activo = activo
        self.db.commit()
        self.db.refresh(usuario)
        return usuario
