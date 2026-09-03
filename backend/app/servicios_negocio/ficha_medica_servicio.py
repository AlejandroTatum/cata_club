from sqlalchemy.orm import Session

from app.dominio.enums import TipoSangre
from app.dominio.modelos import ConsultaFichaEmergencia, FichaMedica, Enfermedades
from app.dominio.excepciones import EntidadNoEncontrada, EntidadDuplicada, OperacionInvalida
from app.dominio.nombre_propio import nombre_completo
from app.dominio.telefono import MENSAJE_TELEFONO_EMERGENCIA_IGUAL, telefonos_coinciden
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import FichaMedicaRepositorio
from app.servicios_negocio.dtos.persona_schemas import (
    FichaEmergenciaResponseDTO, FichaMedicaCreateDTO, FichaMedicaUpdateDTO,
)


class FichaMedicaServicio:
    def __init__(self, db: Session):
        # Guardada además de los repositorios: `_registrar_consulta_emergencia`
        # inserta `ConsultaFichaEmergencia` directamente (mismo patrón que
        # `AuthServicio._registrar_sesion`), sin un repositorio propio para
        # una tabla observacional de una sola escritura.
        self.db = db
        self.repo = FichaMedicaRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)

    def crear_ficha_medica(self, datos: FichaMedicaCreateDTO) -> FichaMedica:
        persona = self.repo_persona.obtener_por_id(datos.persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        if persona.ficha_medica:
            raise EntidadDuplicada("La persona ya tiene una ficha médica registrada")
        # Issue #860: `FichaMedicaCreateDTO` no lleva el teléfono personal --
        # solo `persona_id` -- así que el DTO no puede comparar por sí solo.
        # Este candado es lo que hace que la regla valga también acá, no
        # solo en los tres DTOs que sí traen ambos campos.
        if telefonos_coinciden(persona.telefono, datos.telefono_emergencia):
            raise OperacionInvalida(MENSAJE_TELEFONO_EMERGENCIA_IGUAL)

        ficha = FichaMedica(
            tipo_sangre=datos.tipo_sangre,
            persona_id=datos.persona_id,
            alergias=datos.alergias,
            contacto_emergencia=datos.contacto_emergencia,
            telefono_emergencia=datos.telefono_emergencia,
        )
        for nombre in datos.enfermedades:
            ficha.enfermedades.append(Enfermedades(nombre_enfermedad=nombre))
        resultado = self.repo.crear(ficha)
        self.db.commit()
        return resultado

    def listar_personas_con_ficha(self, persona_ids: list[int]) -> set[int]:
        """Issue #362: de `persona_ids`, cuáles YA tienen ficha médica. Solo
        delega -- ver `FichaMedicaRepositorio.listar_persona_ids_con_ficha`
        para la consulta y por qué es una sola `IN`, no un loop."""
        return self.repo.listar_persona_ids_con_ficha(persona_ids)

    def obtener_por_persona(self, persona_id: int) -> FichaMedica:
        persona = self.repo_persona.obtener_por_id(persona_id)
        if not persona or not persona.ficha_medica:
            raise EntidadNoEncontrada("Ficha médica no encontrada")
        return persona.ficha_medica

    def actualizar_por_persona(self, persona_id: int, datos: FichaMedicaUpdateDTO) -> FichaMedica:
        """PATCH parcial con upsert: si la persona ya tiene ficha médica, solo
        toca los campos que vienen en el payload. Si no tiene, la crea con los
        datos proporcionados (requiere ficha completa, ver #643).

        El parche sigue siendo PARCIAL — mandar un solo campo es legítimo — pero
        no puede dejar una ficha persistida inválida. Las dos mitades de esa
        frase se hacen cumplir en lugares distintos: `FichaMedicaUpdateDTO`
        valida el PAYLOAD (qué valores pueden entrar), y
        `_exigir_ficha_completa` de abajo valida el RESULTADO (cómo queda la
        fila después de aplicarlo). Hace falta la segunda porque una ficha
        legada — anterior a la regla, sin teléfono o con `DESCONOCIDO` — pasa la
        primera con cualquier parche que no la mencione, y quedaría escrita de
        nuevo, todavía inválida, por una operación de hoy.
        """
        persona = self.repo_persona.obtener_por_id(persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")

        ficha = persona.ficha_medica

        if ficha is None:
            # El upsert CREA una ficha, así que la crea completa o no la crea.
            # La persona existe y la ficha todavía no: falta un dato de
            # entrada, no un recurso. Por eso `OperacionInvalida` (400) y no
            # `EntidadNoEncontrada` (404). El texto tampoco nombra las columnas
            # internas.
            self._exigir_ficha_completa(
                tipo_sangre=datos.tipo_sangre,
                telefono_emergencia=datos.telefono_emergencia,
                al_crear=True,
            )
            # Issue #860, mismo motivo que en `crear_ficha_medica`: el upsert
            # del PATCH tampoco recibe el teléfono personal en el payload.
            if telefonos_coinciden(persona.telefono, datos.telefono_emergencia):
                raise OperacionInvalida(MENSAJE_TELEFONO_EMERGENCIA_IGUAL)
            ficha = FichaMedica(
                tipo_sangre=datos.tipo_sangre,
                persona_id=persona_id,
                alergias=datos.alergias,
                contacto_emergencia=datos.contacto_emergencia,
                telefono_emergencia=datos.telefono_emergencia,
            )
            if datos.enfermedades:
                for n in datos.enfermedades:
                    ficha.enfermedades.append(Enfermedades(nombre_enfermedad=n))
            resultado = self.repo.crear(ficha)
            self.db.commit()
            return resultado

        # FIC-5: `is not None` no distinguía "el campo no vino en el PATCH"
        # de "vino explícitamente en null" -- ambos se leían igual y borrar
        # alergias/contacto/teléfono quedaba sin efecto (mismo bug que
        # `exclude_unset=True` ya resuelve en descuento_servicio.py y
        # auth_servicio.py). `enfermedades` no lo sufría porque el frontend
        # siempre manda una lista, nunca None.
        campos = datos.model_dump(exclude_unset=True)
        if "tipo_sangre" in campos:
            ficha.tipo_sangre = campos["tipo_sangre"]
        if "enfermedades" in campos:
            ficha.enfermedades = [Enfermedades(nombre_enfermedad=n) for n in campos["enfermedades"]]
        if "alergias" in campos:
            ficha.alergias = campos["alergias"]
        if "contacto_emergencia" in campos:
            ficha.contacto_emergencia = campos["contacto_emergencia"]
        if "telefono_emergencia" in campos:
            ficha.telefono_emergencia = campos["telefono_emergencia"]

        # El resultado, no el payload (#643). `ficha` ya tiene aplicados los
        # campos del parche, así que esto mira exactamente la fila que está por
        # guardarse. Una ficha legada que el parche no completó muere acá, ANTES
        # del `guardar_cambios`, así que la fila queda como estaba.
        self._exigir_ficha_completa(
            tipo_sangre=ficha.tipo_sangre,
            telefono_emergencia=ficha.telefono_emergencia,
            al_crear=False,
        )
        # Issue #860: se mira el RESULTADO del parche (`ficha`, ya aplicado
        # arriba), no `datos` -- un PATCH que no toca `telefono_emergencia`
        # deja la fila con lo que ya tenía, y esta comprobación tiene que ver
        # exactamente eso, no solo lo que vino en este request.
        if telefonos_coinciden(persona.telefono, ficha.telefono_emergencia):
            raise OperacionInvalida(MENSAJE_TELEFONO_EMERGENCIA_IGUAL)
        resultado = self.repo.guardar_cambios(ficha)
        self.db.commit()
        return resultado

    @staticmethod
    def _exigir_ficha_completa(*, tipo_sangre, telefono_emergencia, al_crear: bool) -> None:
        """Las dos condiciones que hacen COMPLETA a una ficha médica (#643).

        Los mensajes nombran el dato como lo llama una persona ("tipo de
        sangre", "teléfono de emergencia"), nunca la columna
        (`tipo_sangre`, `telefono_emergencia`): los lee un administrador en
        pantalla. Mismo criterio que ya seguía el 400 del upsert.

        Se acumulan las dos faltas en un solo mensaje en vez de cortar en la
        primera: una ficha legada suele carecer de ambas, y hacer que el
        usuario descubra la segunda recién después de arreglar la primera es
        dos viajes para un solo problema.
        """
        faltantes = []
        if tipo_sangre is None or tipo_sangre is TipoSangre.DESCONOCIDO:
            faltantes.append("el tipo de sangre")
        if not telefono_emergencia:
            faltantes.append("el teléfono de emergencia")
        if not faltantes:
            return

        accion = "crear" if al_crear else "guardar"
        raise OperacionInvalida(
            f"Para {accion} la ficha médica debe indicar {' y '.join(faltantes)}."
        )

    def obtener_ficha_emergencia(
        self, persona_id: int, consultante_persona_id: int,
    ) -> FichaEmergenciaResponseDTO:
        """Issue #360: los cuatro datos de emergencia de un alumno, con el
        respaldo del representante legal, para un entrenador que necesita
        actuar YA. El control de acceso es de ROL (`GestorPermisos` en el
        router, no `PoliticaAccesoPersona`): el club no asigna entrenadores a
        horarios, así que "los alumnos de este entrenador" no existe como
        concepto -- cualquier entrenador puede enfrentar la emergencia de
        cualquier alumno. Lo que se acota es el DATO, no el universo de
        alumnos.

        Sin ficha médica cargada: NO es un error. `ficha` queda `None` y los
        cuatro campos médicos viajan `null` -- la pantalla nunca debe quedar
        vacía ni tirar un 404, porque el respaldo del representante (que
        siempre existe para un menor) sigue siendo información útil.

        La consulta se registra DESPUÉS de confirmar que la persona existe,
        mismo orden que `AuthServicio._registrar_sesion`: un 404 no debe dejar
        una fila de auditoría de una consulta que en los hechos no ocurrió.
        """
        persona = self.repo_persona.obtener_por_id(persona_id)
        if not persona:
            raise EntidadNoEncontrada("No se encontró un alumno con ese identificador")

        ficha = persona.ficha_medica
        representante = persona.representante

        self._registrar_consulta_emergencia(
            alumno_persona_id=persona_id, consultante_persona_id=consultante_persona_id,
        )

        return FichaEmergenciaResponseDTO(
            alumno_nombre_completo=nombre_completo(persona.nombres, persona.apellidos),
            tipo_sangre=ficha.tipo_sangre if ficha else None,
            alergias=ficha.alergias if ficha else None,
            contacto_emergencia=ficha.contacto_emergencia if ficha else None,
            telefono_emergencia=ficha.telefono_emergencia if ficha else None,
            representante_nombre_completo=(
                nombre_completo(representante.nombres, representante.apellidos) if representante else None
            ),
            representante_telefono=representante.telefono if representante else None,
        )

    def _registrar_consulta_emergencia(
        self, *, alumno_persona_id: int, consultante_persona_id: int,
    ) -> None:
        """Deja constancia de la consulta. Nada más -- ver el docstring de
        `ConsultaFichaEmergencia`: esta tabla nunca decide acceso."""
        consulta = ConsultaFichaEmergencia(
            alumno_persona_id=alumno_persona_id,
            consultante_persona_id=consultante_persona_id,
        )
        self.db.add(consulta)
        self.db.commit()
