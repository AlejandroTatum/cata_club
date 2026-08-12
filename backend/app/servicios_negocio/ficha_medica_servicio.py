from sqlalchemy.orm import Session

from app.dominio.modelos import FichaMedica, Enfermedades
from app.dominio.excepciones import EntidadNoEncontrada, EntidadDuplicada, OperacionInvalida
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import FichaMedicaRepositorio
from app.presentacion.schemas.persona_schemas import FichaMedicaCreateDTO, FichaMedicaUpdateDTO


class FichaMedicaServicio:
    def __init__(self, db: Session):
        self.repo = FichaMedicaRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)

    def crear_ficha_medica(self, datos: FichaMedicaCreateDTO) -> FichaMedica:
        persona = self.repo_persona.obtener_por_id(datos.persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        if persona.ficha_medica:
            raise EntidadDuplicada("La persona ya tiene una ficha médica registrada")

        ficha = FichaMedica(
            tipo_sangre=datos.tipo_sangre,
            persona_id=datos.persona_id,
            alergias=datos.alergias,
            contacto_emergencia=datos.contacto_emergencia,
            telefono_emergencia=datos.telefono_emergencia,
        )
        for nombre in datos.enfermedades:
            ficha.enfermedades.append(Enfermedades(nombre_enfermedad=nombre))
        return self.repo.crear(ficha)

    def obtener_por_persona(self, persona_id: int) -> FichaMedica:
        persona = self.repo_persona.obtener_por_id(persona_id)
        if not persona or not persona.ficha_medica:
            raise EntidadNoEncontrada("Ficha médica no encontrada")
        return persona.ficha_medica

    def actualizar_por_persona(self, persona_id: int, datos: FichaMedicaUpdateDTO) -> FichaMedica:
        """PATCH parcial con upsert: si la persona ya tiene ficha médica, solo
        toca los campos que vienen en el payload. Si no tiene, la crea con los
        datos proporcionados (requiere tipo_sangre)."""
        persona = self.repo_persona.obtener_por_id(persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")

        ficha = persona.ficha_medica

        if ficha is None:
            tipo_sangre = datos.tipo_sangre
            if tipo_sangre is None:
                # La persona existe y la ficha todavía no: falta un dato de
                # entrada, no un recurso. Por eso `OperacionInvalida` (400) y
                # no `EntidadNoEncontrada` (404). El texto tampoco nombra la
                # columna interna `tipo_sangre`.
                raise OperacionInvalida(
                    "Para crear la ficha médica debe indicar el tipo de sangre."
                )
            ficha = FichaMedica(
                tipo_sangre=tipo_sangre,
                persona_id=persona_id,
                alergias=datos.alergias,
                contacto_emergencia=datos.contacto_emergencia,
                telefono_emergencia=datos.telefono_emergencia,
            )
            if datos.enfermedades:
                for n in datos.enfermedades:
                    ficha.enfermedades.append(Enfermedades(nombre_enfermedad=n))
            return self.repo.crear(ficha)

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
        return self.repo.guardar_cambios(ficha)
