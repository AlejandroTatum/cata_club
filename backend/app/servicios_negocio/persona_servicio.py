from datetime import date
from sqlalchemy.orm import Session

from app.dominio.modelos import Persona, Usuario, FichaMedica, Enfermedades
from app.dominio.enums import TipoRol
from app.dominio.excepciones import EntidadNoEncontrada, EntidadDuplicada, OperacionInvalida
from app.seguridad.gestor_auth import GestorAutenticacion
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import (
    UsuarioRepositorio, FichaMedicaRepositorio,
)
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.presentacion.schemas.persona_schemas import (
    PersonaCreateDTO, PersonaUpdateDTO, RepresentadoCreateDTO, IndependizarDTO,
)


# --- Restricciones de dominio: edad y tutor legal ---------------------------
# Solo se admiten alumnos entre 5 y 74 años. Si el alumno es menor de edad
# (5 a 17 años), el Representante/Tutor legal es OBLIGATORIO; no basta con
# que la columna sea nullable a nivel de BD: la regla se aplica en el
# servicio de dominio, no en el ORM ni en el router.
EDAD_MINIMA_ALUMNO = 5
EDAD_MAXIMA_ALUMNO = 74
EDAD_MAYORIA_EDAD = 18


def _calcular_edad(fecha_nacimiento: date, referencia: date | None = None) -> int:
    ref = referencia or date.today()
    anos = ref.year - fecha_nacimiento.year
    if (ref.month, ref.day) < (fecha_nacimiento.month, fecha_nacimiento.day):
        anos -= 1
    return anos


class PersonaServicio:
    """Contiene las reglas de negocio de Persona. No conoce FastAPI ni HTTPException;
    comunica errores mediante excepciones de dominio."""

    def __init__(self, db: Session):
        self.db = db
        self.repo = PersonaRepositorio(db)
        self.repo_usuario = UsuarioRepositorio(db)
        self.repo_rol = RolRepositorio(db)

    def registrar_persona(self, datos: PersonaCreateDTO) -> Persona:
        if self.repo.obtener_por_cedula(datos.cedula):
            raise EntidadDuplicada(f"Ya existe una persona con la cédula {datos.cedula}")

        edad = _calcular_edad(datos.fecha_nacimiento)
        if edad < EDAD_MINIMA_ALUMNO or edad > EDAD_MAXIMA_ALUMNO:
            raise OperacionInvalida(
                f"La edad del alumno debe estar entre {EDAD_MINIMA_ALUMNO} y "
                f"{EDAD_MAXIMA_ALUMNO} años (calculado: {edad})."
            )
        if EDAD_MINIMA_ALUMNO <= edad < EDAD_MAYORIA_EDAD and not datos.representante_id:
            raise OperacionInvalida(
                "El alumno es menor de edad (5-17 años): los datos del Representante/"
                "Tutor legal (representante_id) son obligatorios."
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
                raise EntidadDuplicada("El correo ya está en uso por otra cuenta")
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

    def _asignar_rol(self, usuario: Usuario, tipo_rol: TipoRol) -> None:
        """Asigna un rol al usuario si aún no lo tiene (idempotente)."""
        if any(r.tipo_rol == tipo_rol for r in usuario.roles):
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
        return self.obtener_persona(persona_id).representados

    def listar_entrenadores(self) -> list[Persona]:
        """Personas con rol ENTRENADOR — usado por el selector de entrenador
        al crear/editar un `HorarioEntrenamiento` (dropdown con nombres
        reales en vez de un ID a mano)."""
        return self.repo.listar_por_rol(TipoRol.ENTRENADOR)

    def actualizar_persona(self, persona_id: int, cambios: PersonaUpdateDTO) -> Persona:
        persona = self.obtener_persona(persona_id)
        datos = cambios.model_dump(exclude_unset=True)
        return self.repo.actualizar(persona, datos)

    def eliminar_persona(self, persona_id: int) -> None:
        persona = self.obtener_persona(persona_id)
        self.repo.eliminar(persona)

    def independizar(self, persona_id: int, datos: IndependizarDTO) -> Persona:
        """Permite a un ex-menor (mayor de edad) independizarse de su
        representante legal. Validaciones:
        1. La persona debe existir y tener representante_id.
        2. Debe ser mayor de edad (>= 18).
        3. La contraseña proporcionada debe coincidir con la del Usuario.
        4. No debe tener deudas pendientes (membresías sin pago o pagos
           pendientes de validación).

        Resultado: representante_id = None, se asigna rol REPRESENTANTE."""
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
        self._asignar_rol(usuario, TipoRol.REPRESENTANTE)

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
