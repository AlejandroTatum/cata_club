"""
`ContraseniaValidada` (issue #1017, ADR-5): cablea `validar_contrasenia` en
los 7 campos reales que acuñan o restablecen una credencial. "No alcanza con
probarla en uno" -- mismo criterio que `test_validacion_identidad_dtos.py`
ya usa para cédula/teléfono: instanciar el DTO prueba lo mismo que un
round-trip HTTP.

NO cubre `IndependizarDTO.contrasenia` (`persona_schemas.py:107`): verifica
la contraseña YA EXISTENTE del llamante, no acuña una nueva -- `test_
independizar.py` guarda esa exclusión.
"""
from datetime import date

import pytest
from pydantic import BaseModel, ValidationError

from app.dominio.cedula import cedula_valida
from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.dtos.auth_schemas import RegistroUsuarioDTO, RestablecerContraseniaDTO
from app.servicios_negocio.dtos.enrollment_schemas import (
    EnrollmentAlumnoDTO,
    EnrollmentCredencialesDTO,
    EnrollmentRepresentanteDTO,
)
from app.servicios_negocio.dtos.persona_schemas import RepresentadoCreateDTO
from app.servicios_negocio.dtos.validadores import ContraseniaValidada
from tests.fabricas_auth import crear_usuario_auth

_CEDULA = cedula_valida(9101)
_FECHA_NACIMIENTO = date(1990, 5, 14)
_TELEFONO = "0991234567"
_CONTRASENIA_COMUN = "12345678"


class _DTOContrasenia(BaseModel):
    contrasenia: ContraseniaValidada


def test_contrasenia_validada_acepta_valor_de_ocho_no_comun():
    dto = _DTOContrasenia(contrasenia="miclavefuerte1")
    assert dto.contrasenia == "miclavefuerte1"


def test_contrasenia_validada_rechaza_comun_aunque_cumpla_el_piso():
    with pytest.raises(ValidationError) as error:
        _DTOContrasenia(contrasenia=_CONTRASENIA_COMUN)
    assert "usada" in str(error.value)


def _construir(dto_nombre: str, contrasenia: str):
    """Un payload mínimo válido por cada uno de los 7 campos reales,
    sobreescribiendo solo la contraseña bajo prueba (mismo criterio que
    `test_nombres_limite_escritura.py::_instanciar`)."""
    comun = dict(
        nombres="Juan", apellidos="Pérez", cedula=_CEDULA,
        fecha_nacimiento=_FECHA_NACIMIENTO, telefono=_TELEFONO,
        correo="juan@test.com", contrasenia=contrasenia,
    )
    fabricas = {
        "EnrollmentRepresentanteDTO": lambda: EnrollmentRepresentanteDTO(**comun),
        "EnrollmentAlumnoDTO": lambda: EnrollmentAlumnoDTO(**comun),
        "EnrollmentCredencialesDTO": lambda: EnrollmentCredencialesDTO(
            correo="juan@test.com", contrasenia=contrasenia,
        ),
        "AdminCrearCuentaDTO": lambda: AdminCrearCuentaDTO(tipo_cuenta="ENTRENADOR", **comun),
        "RegistroUsuarioDTO": lambda: RegistroUsuarioDTO(
            cedula=_CEDULA, correo="juan@test.com", contrasenia=contrasenia,
        ),
        "RestablecerContraseniaDTO": lambda: RestablecerContraseniaDTO(
            token="abc123", nueva_contrasenia=contrasenia,
        ),
        "RepresentadoCreateDTO": lambda: RepresentadoCreateDTO(**comun),
    }
    return fabricas[dto_nombre]()


@pytest.mark.parametrize("dto_nombre", [
    "EnrollmentRepresentanteDTO", "EnrollmentAlumnoDTO", "EnrollmentCredencialesDTO",
    "AdminCrearCuentaDTO", "RegistroUsuarioDTO", "RestablecerContraseniaDTO",
    "RepresentadoCreateDTO",
])
def test_cada_uno_de_los_siete_campos_reales_aplica_la_misma_regla(dto_nombre):
    with pytest.raises(ValidationError):
        _construir(dto_nombre, _CONTRASENIA_COMUN)
    _construir(dto_nombre, "miclavefuerte1")  # no lanza


# --- issue #1043: tope de 72 bytes, cableado en los mismos 7 campos --------
_CONTRASENIA_QUE_SUPERA_72_BYTES = "x" * 73


@pytest.mark.parametrize("dto_nombre", [
    "EnrollmentRepresentanteDTO", "EnrollmentAlumnoDTO", "EnrollmentCredencialesDTO",
    "AdminCrearCuentaDTO", "RegistroUsuarioDTO", "RestablecerContraseniaDTO",
    "RepresentadoCreateDTO",
])
def test_cada_uno_de_los_siete_campos_reales_rechaza_mas_de_72_bytes(dto_nombre):
    with pytest.raises(ValidationError) as error:
        _construir(dto_nombre, _CONTRASENIA_QUE_SUPERA_72_BYTES)
    assert "72 bytes" in str(error.value)


# --- Regresión: la lista negra no toca hashes ya guardados (issue #1017) ---
def test_cuenta_previa_con_contrasenia_ahora_comun_sigue_pudiendo_loguearse(db_session, client):
    """Agregar la lista negra NO invalida ningún hash ya guardado: una
    `Usuario` creada ANTES de este cambio con una contraseña que la lista
    ahora rechaza sigue entrando con su contraseña actual hasta que la
    cambie. `crear_usuario_auth` construye el `Usuario` directo por ORM
    (bypasea `ContraseniaValidada` a propósito -- así se representa una fila
    escrita antes de este cambio), y `POST /auth/login` nunca re-valida la
    contraseña contra la lista negra: solo compara el hash."""
    crear_usuario_auth(db_session, correo="previa@cataclub.test", contrasenia="12345678")

    respuesta = client.post(
        "/api/v1/auth/login",
        data={"username": "previa@cataclub.test", "password": "12345678"},
    )

    assert respuesta.status_code == 200
