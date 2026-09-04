"""
Servicio de creación de cuentas por el Administrador.

Orquesta la creación de Persona + Usuario + Rol en un solo request
transaccional. Soporta cuatro tipos de cuenta:
  - JUGADOR: adulto que juega (rol ALUMNO)
  - REPRESENTANTE: adulto que representa a un menor (rol REPRESENTANTE)
  - MENOR: dependiente de un representante existente (rol ALUMNO)
  - ENTRENADOR: adulto que dicta los entrenamientos (rol ENTRENADOR)

ENTRENADOR es el único tipo que NO recibe ALUMNO: entrena al club, no se
matricula en él. Antes de existir este tipo, dar de alta a un entrenador
exigía crear la cuenta como JUGADOR y después corregir los roles a mano
desde el panel de miembros.
"""
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Usuario, FichaMedica, Enfermedades
from app.dominio.enums import TipoRol
from app.dominio.excepciones import EntidadDuplicada, EntidadNoEncontrada, OperacionInvalida
from app.dominio.rol_unico import exigir_rol_unico
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import (
    UsuarioRepositorio, FichaMedicaRepositorio,
)
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.persona_servicio import (
    _calcular_edad, EDAD_MINIMA_ALUMNO, EDAD_MAXIMA_ALUMNO, EDAD_MAYORIA_EDAD,
)


# Tipos de cuenta que exigen mayoría de edad, con su plural en español para
# el mensaje de error (`tipo_cuenta.lower() + "s"` producía "jugadors").
TIPOS_CUENTA_ADULTA = {
    "JUGADOR": "jugadores",
    "REPRESENTANTE": "representantes",
    "ENTRENADOR": "entrenadores",
}

# Rol otorgado por tipo de cuenta. Exactamente UNO por tipo (issue #762):
# hasta este issue "REPRESENTANTE" entregaba REPRESENTANTE **y** ALUMNO, o
# sea que el alta administrativa fabricaba una cuenta multirol de fábrica y
# ninguno de los otros tres caminos de alta podía verlo.
#
# Un representante que además entrena no pierde nada que el sistema le diera:
# la representación se autoriza por el VÍNCULO de datos
# (`persona.representante_id`, ver `PoliticaAcceso.puede_acceder`), no por el
# rol; el rol REPRESENTANTE solo habilita "agregar/vincular dependiente".
# Si además necesita matricularse, es un cambio de rol explícito, no un
# arrastre automático.
ROLES_POR_TIPO_CUENTA = {
    "JUGADOR": (TipoRol.ALUMNO,),
    "REPRESENTANTE": (TipoRol.REPRESENTANTE,),
    "MENOR": (TipoRol.ALUMNO,),
    "ENTRENADOR": (TipoRol.ENTRENADOR,),
}


class AdminCuentaServicio:
    """Crea cuentas completas (Persona + Usuario + Rol) desde el panel admin."""

    def __init__(self, db: Session):
        self.db = db
        self.repo_persona = PersonaRepositorio(db)
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_ficha = FichaMedicaRepositorio(db)
        self.repo_rol = RolRepositorio(db)

    def crear_cuenta(self, datos: AdminCrearCuentaDTO) -> dict:
        """
        Flujo completo de creación de cuenta admin.

        Retorna: { persona_id, usuario_id, correo }. Issue #1015: NO emite
        tokens de acceso/refresco -- el llamador es el ADMINISTRADOR
        autenticado que hace el alta, nunca la cuenta recién creada, así que
        un par de tokens acá sería un par de credenciales vivas y sin dueño
        en su navegador.
        """
        # 1. Validar que la cédula no exista
        if self.repo_persona.obtener_por_cedula(datos.cedula):
            raise EntidadDuplicada(
                f"Ya existe una persona con la cédula {datos.cedula}"
            )

        # 2. Validar que el correo no exista
        if self.repo_usuario.obtener_por_correo(datos.correo):
            raise EntidadDuplicada("El correo ya está en uso por otra cuenta")

        # 3. Validar edad según tipo de cuenta
        edad = _calcular_edad(datos.fecha_nacimiento)

        if datos.tipo_cuenta in TIPOS_CUENTA_ADULTA:
            # Auditoría 2026-08-10: esta rama solo validaba el piso, así que
            # una fecha de nacimiento de 1700 (326 años) pasaba sin aviso. No
            # hay una cota de "adulto" propia -- se reutiliza
            # `EDAD_MAXIMA_ALUMNO` (74), el único techo que el sistema
            # define para una persona. Desde el issue #762 REPRESENTANTE ya
            # no arrastra ALUMNO, así que el techo dejó de derivarse del rol
            # y pasó a ser lo que siempre fue en los hechos: la única cota
            # de edad que el sistema conoce.
            if edad < EDAD_MAYORIA_EDAD or edad > EDAD_MAXIMA_ALUMNO:
                raise OperacionInvalida(
                    f"Los {TIPOS_CUENTA_ADULTA[datos.tipo_cuenta]} deben ser "
                    f"mayores de edad, entre {EDAD_MAYORIA_EDAD} y "
                    f"{EDAD_MAXIMA_ALUMNO} años (calculado: {edad})."
                )

        if datos.tipo_cuenta == "MENOR":
            if edad >= EDAD_MAYORIA_EDAD:
                raise OperacionInvalida(
                    f"La persona es mayor de edad ({edad} años). "
                    "Registre la cuenta como jugador o como representante.",
                    detalle_tecnico=f"tipo_cuenta=MENOR con edad calculada {edad}",
                )
            if edad < EDAD_MINIMA_ALUMNO:
                raise OperacionInvalida(
                    f"La edad del alumno debe estar entre {EDAD_MINIMA_ALUMNO} y "
                    f"{EDAD_MAXIMA_ALUMNO} años (calculado: {edad})."
                )
            if not datos.representante_id:
                raise OperacionInvalida(
                    "El menor requiere un representante legal.",
                    detalle_tecnico="falta representante_id en una cuenta de tipo menor",
                )

        # 4. Validar representante si aplica
        if datos.representante_id:
            representante = self.repo_persona.obtener_por_id(datos.representante_id)
            if not representante:
                raise EntidadNoEncontrada(
                    f"Representante con id {datos.representante_id} no encontrado"
                )
            edad_rep = _calcular_edad(representante.fecha_nacimiento)
            if edad_rep < EDAD_MAYORIA_EDAD:
                raise OperacionInvalida(
                    f"El representante legal debe ser mayor de edad "
                    f"({EDAD_MAYORIA_EDAD} años o más); el representante indicado "
                    f"tiene {edad_rep} años."
                )

        # 5. Crear Persona
        persona = Persona(
            nombres=datos.nombres,
            apellidos=datos.apellidos,
            cedula=datos.cedula,
            fecha_nacimiento=datos.fecha_nacimiento,
            telefono=datos.telefono,
            telefono_contacto=datos.telefono_contacto,
            representante_id=datos.representante_id,
            direccion_id=datos.direccion_id,
            institucion_id=datos.institucion_id,
        )
        self.repo_persona.crear(persona)

        # 6. Crear Usuario (credenciales)
        hash_pw = GestorAutenticacion.obtener_hash_contrasenia(datos.contrasenia)
        usuario = Usuario(
            correo=datos.correo,
            contrasenia=hash_pw,
            persona_id=persona.id,
            # Issue #790: nace verificada. Este endpoint exige ya una sesión
            # de ADMINISTRADOR, así que no es el eslabón que ese issue cierra
            # -- ese es la autoinscripción PÚBLICA. Dejarla sin verificar no
            # protegería nada y rompería el mostrador: el administrador que da
            # de alta a un padre parado frente a él quedaría sin poder
            # vincularle a su hijo hasta que llegue un correo. Que el club
            # identifique a alguien en persona es una comprobación más fuerte
            # que una ida y vuelta por correo, no una más débil.
            correo_verificado=True,
        )
        self.repo_usuario.crear(usuario)

        # 7. Asignar roles según tipo de cuenta
        for tipo_rol in ROLES_POR_TIPO_CUENTA.get(datos.tipo_cuenta, ()):
            self._asignar_rol(usuario, tipo_rol)

        # 8. Crear Ficha Médica si se proporcionó
        if datos.ficha_medica:
            ficha = FichaMedica(
                tipo_sangre=datos.ficha_medica.tipo_sangre,
                persona_id=persona.id,
                alergias=datos.ficha_medica.alergias,
                contacto_emergencia=datos.ficha_medica.contacto_emergencia,
                telefono_emergencia=datos.ficha_medica.telefono_emergencia,
            )
            for nombre in datos.ficha_medica.enfermedades:
                ficha.enfermedades.append(Enfermedades(nombre_enfermedad=nombre))
            self.repo_ficha.crear(ficha)

        # 9. Un solo commit para toda la operación (issue #831): antes,
        # Persona, Usuario, cada asignación de rol y la FichaMedica
        # comiteaban por separado -- si el último paso fallaba, los
        # anteriores ya habían quedado persistidos.
        self.db.commit()

        # 10. Devolver la identidad creada (issue #1015: sin tokens -- ver
        # el docstring de este método).
        return {
            "persona_id": persona.id,
            "usuario_id": usuario.id,
            "correo": usuario.correo,
        }

    def _asignar_rol(self, usuario: Usuario, tipo_rol: TipoRol) -> None:
        """Asigna un rol al usuario si aún no lo tiene (idempotente).

        La regla de "un solo rol activo" (issue #762) la decide
        `exigir_rol_unico`, compartida con los otros tres caminos de alta:
        antes cada uno tenía esta misma comparación copiada y solo miraba el
        duplicado del MISMO rol.

        Solo `flush()` (issue #831): forma parte de la transacción atómica
        de `crear_cuenta`, que hace el único `commit()` al final."""
        if not exigir_rol_unico(usuario, tipo_rol):
            return
        rol = self.repo_rol.obtener_o_crear(tipo_rol)
        usuario.roles.append(rol)
        self.db.flush()
