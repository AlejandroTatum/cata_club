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
from app.dominio.telefono import MENSAJE_TELEFONO_EMERGENCIA_IGUAL
from app.presentacion.schemas.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.presentacion.schemas.auth_schemas import ActualizarPerfilPropioDTO, RegistroUsuarioDTO
from app.presentacion.schemas.enrollment_schemas import (
    EnrollmentAlumnoDTO,
    EnrollmentCreateDTO,
    EnrollmentCredencialesDTO,
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
# Un segundo teléfono válido, distinto del anterior — el contacto de
# emergencia de cada fixture de abajo (issue #860: dos números iguales ya no
# pueden convivir en el mismo DTO).
TELEFONO_EMERGENCIA_VALIDO = "0987654321"
# Los tres formatos que el criterio de aceptación del #860 exige reconocer
# como el mismo número que TELEFONO_VALIDO (issue #855).
FORMATOS_EQUIVALENTES_A_TELEFONO_VALIDO = ["0991234567", "+593991234567", "593991234567"]
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

    # --- Issue #855: normalización de celulares autocompletados en formato --
    # --- internacional -------------------------------------------------------
    @pytest.mark.parametrize(
        "telefono",
        ["+593991234567", "593991234567", "0991234567"],
        ids=["593_con_signo_mas", "593_sin_signo_mas", "local_09_no_cambia"],
    )
    def test_acepta_y_normaliza_los_tres_formatos_de_celular(self, telefono):
        # Los tres formatos del criterio de aceptación producen el mismo
        # valor local almacenado -- incluido el que ya venía en formato
        # local, que no cambia.
        persona = PersonaCreateDTO(**self._base(telefono=telefono))
        assert persona.telefono == "0991234567"

    @pytest.mark.parametrize(
        "telefono",
        ["+593223456", "+11234567890"],
        ids=["fijo_con_prefijo_593_el_mapeo_es_mobile_only", "codigo_de_pais_distinto"],
    )
    def test_rechaza_lo_que_el_mapeo_internacional_no_convierte(self, telefono):
        # El mapeo internacional es exclusivo de celulares: un fijo con
        # prefijo 593 no calza con "9" + 8 dígitos, y un código de país
        # distinto tampoco calza -- ambos se rechazan por la razón real, no
        # es un celular ni un fijo válido tal cual llegaron.
        with pytest.raises(ValidationError):
            PersonaCreateDTO(**self._base(telefono=telefono))


def test_otro_dto_normaliza_el_celular_internacional_igual():
    # `EnrollmentAlumnoDTO` reusa el mismo `TelefonoValidado` que
    # `PersonaCreateDTO` -- una sola regla, nueve DTOs (issue #855).
    alumno = EnrollmentAlumnoDTO(
        nombres="Luis",
        apellidos="Gómez",
        cedula=CEDULA_VALIDA,
        fecha_nacimiento=FECHA_NACIMIENTO_ADULTO,
        telefono="+593991234567",
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

    # --- Issue #860: el teléfono de emergencia no puede repetir el personal -

    def _con_ficha(self, telefono_emergencia: str) -> dict:
        return self._base(
            ficha_medica=dict(
                tipo_sangre="O_POSITIVO", contacto_emergencia="Tía Rosa",
                telefono_emergencia=telefono_emergencia,
            ),
        )

    def test_sin_ficha_medica_no_hay_nada_que_comparar(self):
        # `ficha_medica` es opcional en este DTO: sin ella, la regla del
        # #860 no tiene con qué compararse.
        RepresentadoCreateDTO(**self._base())

    def test_acepta_telefono_emergencia_distinto_del_personal(self):
        RepresentadoCreateDTO(**self._con_ficha(TELEFONO_EMERGENCIA_VALIDO))

    def test_rechaza_telefono_emergencia_igual_al_personal(self):
        with pytest.raises(ValidationError) as error:
            RepresentadoCreateDTO(**self._con_ficha(TELEFONO_VALIDO))
        assert MENSAJE_TELEFONO_EMERGENCIA_IGUAL in str(error.value)

    @pytest.mark.parametrize("telefono_emergencia", FORMATOS_EQUIVALENTES_A_TELEFONO_VALIDO)
    def test_rechaza_formatos_equivalentes_al_telefono_personal(self, telefono_emergencia):
        with pytest.raises(ValidationError) as error:
            RepresentadoCreateDTO(**self._con_ficha(telefono_emergencia))
        assert MENSAJE_TELEFONO_EMERGENCIA_IGUAL in str(error.value)


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


class TestEnrollmentCreateDTO:
    """Issue #860, sobre el DTO COMPUESTO: `EnrollmentFichaMedicaDTO` (arriba)
    no ve el teléfono del alumno por sí sola, así que la comparación cruzada
    vive en `EnrollmentCreateDTO`, que sí tiene ambos."""

    def _base(self, telefono_emergencia: str = TELEFONO_EMERGENCIA_VALIDO, **overrides) -> dict:
        datos = dict(
            alumno=EnrollmentAlumnoDTO(
                nombres="Luis", apellidos="Gómez", cedula=CEDULA_VALIDA,
                fecha_nacimiento=FECHA_NACIMIENTO_ADULTO, telefono=TELEFONO_VALIDO,
            ),
            credenciales_alumno=EnrollmentCredencialesDTO(
                correo="luis@example.com", contrasenia="unaClave123",
            ),
            ficha_medica=EnrollmentFichaMedicaDTO(
                tipo_sangre="O_POSITIVO", contacto_emergencia="Tía Rosa",
                telefono_emergencia=telefono_emergencia,
            ),
            acepta_consentimientos=True,
        )
        datos.update(overrides)
        return datos

    def test_acepta_datos_validos(self):
        EnrollmentCreateDTO(**self._base())

    def test_rechaza_telefono_emergencia_igual_al_del_alumno(self):
        with pytest.raises(ValidationError) as error:
            EnrollmentCreateDTO(**self._base(telefono_emergencia=TELEFONO_VALIDO))
        assert MENSAJE_TELEFONO_EMERGENCIA_IGUAL in str(error.value)

    @pytest.mark.parametrize("telefono_emergencia", FORMATOS_EQUIVALENTES_A_TELEFONO_VALIDO)
    def test_rechaza_formatos_equivalentes_al_telefono_del_alumno(self, telefono_emergencia):
        with pytest.raises(ValidationError) as error:
            EnrollmentCreateDTO(**self._base(telefono_emergencia=telefono_emergencia))
        assert MENSAJE_TELEFONO_EMERGENCIA_IGUAL in str(error.value)


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
            #
            # Issue #860: el teléfono de emergencia tiene que ser DISTINTO
            # del personal de arriba — antes reusaba el mismo `TELEFONO_
            # VALIDO`, exactamente el fixture que el issue pide reemplazar.
            ficha_medica=dict(
                tipo_sangre="O_POSITIVO", enfermedades=[],
                contacto_emergencia="María Torres",
                telefono_emergencia=TELEFONO_EMERGENCIA_VALIDO,
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

    # --- Issue #860: el teléfono de emergencia no puede repetir el personal -

    def test_sin_ficha_medica_no_hay_nada_que_comparar(self):
        # REPRESENTANTE no exige ficha médica (#730); sin ella, la
        # comparación del #860 no tiene con qué compararse.
        AdminCrearCuentaDTO(**self._base(tipo_cuenta="REPRESENTANTE", ficha_medica=None))

    def test_rechaza_telefono_emergencia_igual_al_personal(self):
        with pytest.raises(ValidationError) as error:
            AdminCrearCuentaDTO(**self._base(
                ficha_medica=dict(
                    tipo_sangre="O_POSITIVO", enfermedades=[],
                    contacto_emergencia="María Torres",
                    telefono_emergencia=TELEFONO_VALIDO,
                ),
            ))
        assert MENSAJE_TELEFONO_EMERGENCIA_IGUAL in str(error.value)

    @pytest.mark.parametrize("telefono_emergencia", FORMATOS_EQUIVALENTES_A_TELEFONO_VALIDO)
    def test_rechaza_formatos_equivalentes_al_telefono_personal(self, telefono_emergencia):
        with pytest.raises(ValidationError) as error:
            AdminCrearCuentaDTO(**self._base(
                ficha_medica=dict(
                    tipo_sangre="O_POSITIVO", enfermedades=[],
                    contacto_emergencia="María Torres",
                    telefono_emergencia=telefono_emergencia,
                ),
            ))
        assert MENSAJE_TELEFONO_EMERGENCIA_IGUAL in str(error.value)


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
