"""
La validación de cédula y teléfono corre en CADA DTO donde se cablearon
(PR 4b, issue #228) -- no alcanza con probarla en uno. Cada clase de este
archivo es un punto de entrada real: FastAPI construye exactamente este
objeto Pydantic a partir del cuerpo del request, así que instanciarlo
directamente prueba lo mismo que un round-trip HTTP, sin la fricción de
levantar auth/DB para cada uno de los nueve endpoints involucrados. El
wiring end-to-end (formato de la respuesta 422 que arma `main.py`) se
prueba aparte en `test_vincular_representado.py` y no se repite acá.
"""
from datetime import date

import pytest
from pydantic import ValidationError

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoSangre
from app.presentacion.schemas.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.presentacion.schemas.auth_schemas import ActualizarPerfilPropioDTO, RegistroUsuarioDTO
from app.presentacion.schemas.enrollment_schemas import (
    EnrollmentAlumnoDTO,
    EnrollmentFichaMedicaDTO,
    EnrollmentRepresentanteDTO,
)
from app.presentacion.schemas.persona_schemas import (
    FichaMedicaCreateDTO,
    FichaMedicaUpdateDTO,
    PersonaCreateDTO,
    PersonaUpdateDTO,
    RepresentadoCreateDTO,
    VincularRepresentadoDTO,
)

CEDULA_VALIDA = cedula_valida(9001)
CEDULA_INVALIDA = "1712345678"  # issue #228: verificador debería ser 5, tiene 8
TELEFONO_VALIDO = "0991234567"
TELEFONO_INVALIDO = "099abc4567"
# Dígitos arábigo-índicos: `str.isdigit()` los da por buenos, pero ni los
# validadores del dominio ni el `[0-9]` del CHECK de la base los aceptan. Los
# dos tienen la forma "correcta" salvo por el alfabeto: diez caracteres, y el
# teléfono empieza en `٠٩` (el `09` de un celular).
CEDULA_DIGITOS_NO_ASCII = "١٧١٠٠٣٤٠٦٥"
TELEFONO_DIGITOS_NO_ASCII = "٠٩٩١٢٣٤٥٦٧"
FECHA_NACIMIENTO_ADULTO = date(1990, 5, 14)


class TestPersonaCreateDTO:
    def _base(self, **overrides):
        datos = dict(
            nombres="Juana", apellidos="Pérez", cedula=CEDULA_VALIDA,
            fecha_nacimiento=FECHA_NACIMIENTO_ADULTO, telefono=TELEFONO_VALIDO,
        )
        datos.update(overrides)
        return datos

    def test_acepta_cedula_y_telefono_validos(self):
        PersonaCreateDTO(**self._base())

    def test_rechaza_cedula_invalida(self):
        with pytest.raises(ValidationError):
            PersonaCreateDTO(**self._base(cedula=CEDULA_INVALIDA))

    def test_rechaza_telefono_invalido(self):
        with pytest.raises(ValidationError):
            PersonaCreateDTO(**self._base(telefono=TELEFONO_INVALIDO))

    def test_rechaza_telefono_contacto_invalido(self):
        with pytest.raises(ValidationError):
            PersonaCreateDTO(**self._base(telefono_contacto=TELEFONO_INVALIDO))

    def test_acepta_telefono_contacto_ausente(self):
        PersonaCreateDTO(**self._base())

    # --- Qué MENSAJE recibe quien manda dígitos no ASCII --------------------
    # El 422 nunca estuvo en duda: los validadores canónicos exigen dígitos
    # ASCII, así que estos valores se rechazaban igual. Lo que estaba mal era
    # el mensaje: el pre-chequeo del DTO usaba un `isdigit()` pelado, que los
    # acepta, y el error caía en la rama equivocada. Estos dos tests fijan la
    # rama, no el rechazo.
    def test_cedula_con_digitos_no_ascii_reporta_el_error_de_forma(self):
        with pytest.raises(ValidationError) as error:
            PersonaCreateDTO(**self._base(cedula=CEDULA_DIGITOS_NO_ASCII))

        mensaje = str(error.value)
        assert "La cédula debe tener exactamente 10 dígitos." in mensaje
        assert "Ese número de cédula no es válido." not in mensaje

    def test_telefono_con_digitos_no_ascii_reporta_solo_puede_tener_digitos(self):
        with pytest.raises(ValidationError) as error:
            PersonaCreateDTO(**self._base(telefono=TELEFONO_DIGITOS_NO_ASCII))

        mensaje = str(error.value)
        assert "El teléfono solo puede tener dígitos." in mensaje
        assert "empezar en 09" not in mensaje


# Issue #855: un celular autocompletado por el navegador móvil en formato
# internacional se acepta y se normaliza al local -- probado sobre el DTO
# que ya venía usándose para el resto de esta suite (`PersonaCreateDTO`),
# porque `TelefonoValidado` es el mismo `Annotated` en los nueve DTOs.
class TestNormalizacionTelefonoInternacional:
    def _base(self, **overrides):
        datos = dict(
            nombres="Juana", apellidos="Pérez", cedula=CEDULA_VALIDA,
            fecha_nacimiento=FECHA_NACIMIENTO_ADULTO, telefono=TELEFONO_VALIDO,
        )
        datos.update(overrides)
        return datos

    def test_acepta_prefijo_internacional_con_signo_mas_y_lo_normaliza(self):
        persona = PersonaCreateDTO(**self._base(telefono="+593991234567"))
        assert persona.telefono == "0991234567"

    def test_acepta_prefijo_internacional_sin_signo_mas_y_lo_normaliza(self):
        persona = PersonaCreateDTO(**self._base(telefono="593991234567"))
        assert persona.telefono == "0991234567"

    def test_local_09_sigue_almacenandose_igual(self):
        persona = PersonaCreateDTO(**self._base(telefono="0991234567"))
        assert persona.telefono == "0991234567"

    def test_fijo_no_cambia_su_regla(self):
        # El mapeo internacional es exclusivo de celulares -- un fijo con
        # prefijo 593 no calza con "9" + 8 dígitos y se rechaza igual que
        # antes, por la razón real: no es un celular ni un fijo válido tal
        # cual llegó.
        with pytest.raises(ValidationError):
            PersonaCreateDTO(**self._base(telefono="+593223456"))

    def test_rechaza_codigo_de_pais_distinto(self):
        with pytest.raises(ValidationError):
            PersonaCreateDTO(**self._base(telefono="+11234567890"))

    def test_otro_dto_normaliza_igual(self):
        # `EnrollmentAlumnoDTO` reusa el mismo `TelefonoValidado` -- una sola
        # regla, nueve DTOs.
        alumno = EnrollmentAlumnoDTO(
            nombres="Luis", apellidos="Gómez", cedula=CEDULA_VALIDA,
            fecha_nacimiento=FECHA_NACIMIENTO_ADULTO, telefono="+593991234567",
        )
        assert alumno.telefono == "0991234567"


class TestRepresentadoCreateDTO:
    def _base(self, **overrides):
        datos = dict(
            nombres="Luis", apellidos="Gómez", cedula=CEDULA_VALIDA,
            fecha_nacimiento=FECHA_NACIMIENTO_ADULTO, telefono=TELEFONO_VALIDO,
        )
        datos.update(overrides)
        return datos

    def test_acepta_datos_validos(self):
        RepresentadoCreateDTO(**self._base())

    def test_rechaza_cedula_invalida(self):
        with pytest.raises(ValidationError):
            RepresentadoCreateDTO(**self._base(cedula=CEDULA_INVALIDA))

    def test_rechaza_telefono_invalido(self):
        with pytest.raises(ValidationError):
            RepresentadoCreateDTO(**self._base(telefono=TELEFONO_INVALIDO))


class TestVincularRepresentadoDTO:
    def test_acepta_cedula_valida(self):
        VincularRepresentadoDTO(cedula=CEDULA_VALIDA)

    def test_rechaza_cedula_invalida(self):
        with pytest.raises(ValidationError):
            VincularRepresentadoDTO(cedula=CEDULA_INVALIDA)


class TestPersonaUpdateDTO:
    def test_acepta_telefono_valido(self):
        PersonaUpdateDTO(telefono=TELEFONO_VALIDO)

    def test_rechaza_telefono_invalido(self):
        with pytest.raises(ValidationError):
            PersonaUpdateDTO(telefono=TELEFONO_INVALIDO)

    def test_rechaza_telefono_contacto_invalido(self):
        with pytest.raises(ValidationError):
            PersonaUpdateDTO(telefono_contacto=TELEFONO_INVALIDO)

    def test_telefono_ausente_no_se_valida(self):
        # PATCH parcial: no reenviar el campo no debe disparar la regla.
        PersonaUpdateDTO(nombres="Otro nombre")


class TestFichaMedicaDTOs:
    def test_create_acepta_telefono_emergencia_valido(self):
        FichaMedicaCreateDTO(
            tipo_sangre=TipoSangre.O_POSITIVO, persona_id=1,
            telefono_emergencia=TELEFONO_VALIDO,
        )

    def test_create_rechaza_telefono_emergencia_invalido(self):
        with pytest.raises(ValidationError):
            FichaMedicaCreateDTO(
                tipo_sangre=TipoSangre.O_POSITIVO, persona_id=1,
                telefono_emergencia=TELEFONO_INVALIDO,
            )

    def test_update_rechaza_telefono_emergencia_invalido(self):
        with pytest.raises(ValidationError):
            FichaMedicaUpdateDTO(telefono_emergencia=TELEFONO_INVALIDO)


class TestEnrollmentDTOs:
    def test_representante_rechaza_cedula_invalida(self):
        with pytest.raises(ValidationError):
            EnrollmentRepresentanteDTO(
                nombres="Rep", apellidos="Legal", cedula=CEDULA_INVALIDA,
                fecha_nacimiento=FECHA_NACIMIENTO_ADULTO, telefono=TELEFONO_VALIDO,
                correo="rep@example.com", contrasenia="unaClave123",
            )

    def test_representante_rechaza_telefono_invalido(self):
        with pytest.raises(ValidationError):
            EnrollmentRepresentanteDTO(
                nombres="Rep", apellidos="Legal", cedula=CEDULA_VALIDA,
                fecha_nacimiento=FECHA_NACIMIENTO_ADULTO, telefono=TELEFONO_INVALIDO,
                correo="rep@example.com", contrasenia="unaClave123",
            )

    def test_alumno_rechaza_cedula_invalida(self):
        with pytest.raises(ValidationError):
            EnrollmentAlumnoDTO(
                nombres="Alumno", apellidos="Uno", cedula=CEDULA_INVALIDA,
                fecha_nacimiento=FECHA_NACIMIENTO_ADULTO, telefono=TELEFONO_VALIDO,
            )

    def test_alumno_rechaza_telefono_invalido(self):
        with pytest.raises(ValidationError):
            EnrollmentAlumnoDTO(
                nombres="Alumno", apellidos="Uno", cedula=CEDULA_VALIDA,
                fecha_nacimiento=FECHA_NACIMIENTO_ADULTO, telefono=TELEFONO_INVALIDO,
            )

    def test_ficha_medica_rechaza_telefono_emergencia_invalido(self):
        with pytest.raises(ValidationError):
            EnrollmentFichaMedicaDTO(
                tipo_sangre="O_POSITIVO",
                contacto_emergencia="Tía Rosa", telefono_emergencia=TELEFONO_INVALIDO,
            )

    def test_ficha_medica_acepta_telefono_emergencia_valido(self):
        # `tipo_sangre` explícito desde #643: este DTO ya no lo asume
        # `DESCONOCIDO` cuando falta, así que omitirlo acá probaría el default
        # que se eliminó en vez del teléfono que este test mira.
        EnrollmentFichaMedicaDTO(
            tipo_sangre="O_POSITIVO",
            contacto_emergencia="Tía Rosa", telefono_emergencia=TELEFONO_VALIDO,
        )


class TestAdminCrearCuentaDTO:
    def _base(self, **overrides):
        datos = dict(
            tipo_cuenta="JUGADOR", nombres="Ana", apellidos="Ríos",
            cedula=CEDULA_VALIDA, fecha_nacimiento=FECHA_NACIMIENTO_ADULTO,
            telefono=TELEFONO_VALIDO, correo="ana@example.com",
            contrasenia="unaClave123",
            # Issue #730: `tipo_cuenta="JUGADOR"` es un alumno y ya no se da
            # de alta sin ficha médica. Esta clase mide cédula y teléfono, no
            # la ficha.
            ficha_medica=dict(
                tipo_sangre="O_POSITIVO", enfermedades=[],
                contacto_emergencia="María Torres",
                telefono_emergencia=TELEFONO_VALIDO,
            ),
        )
        datos.update(overrides)
        return datos

    def test_acepta_datos_validos(self):
        AdminCrearCuentaDTO(**self._base())

    def test_rechaza_cedula_invalida(self):
        with pytest.raises(ValidationError):
            AdminCrearCuentaDTO(**self._base(cedula=CEDULA_INVALIDA))

    def test_rechaza_telefono_invalido(self):
        with pytest.raises(ValidationError):
            AdminCrearCuentaDTO(**self._base(telefono=TELEFONO_INVALIDO))

    def test_rechaza_telefono_contacto_invalido(self):
        with pytest.raises(ValidationError):
            AdminCrearCuentaDTO(**self._base(telefono_contacto=TELEFONO_INVALIDO))


class TestAuthSchemas:
    def test_registro_acepta_cedula_valida(self):
        RegistroUsuarioDTO(cedula=CEDULA_VALIDA, correo="x@example.com", contrasenia="unaClave123")

    def test_registro_rechaza_cedula_invalida(self):
        with pytest.raises(ValidationError):
            RegistroUsuarioDTO(cedula=CEDULA_INVALIDA, correo="x@example.com", contrasenia="unaClave123")

    def test_actualizar_perfil_acepta_telefono_valido(self):
        ActualizarPerfilPropioDTO(telefono=TELEFONO_VALIDO)

    def test_actualizar_perfil_rechaza_telefono_invalido(self):
        with pytest.raises(ValidationError):
            ActualizarPerfilPropioDTO(telefono=TELEFONO_INVALIDO)

    def test_actualizar_perfil_telefono_ausente_no_se_valida(self):
        ActualizarPerfilPropioDTO()
