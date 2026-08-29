"""Administrators may register cash payments from the Members flow.

Cash registration remains restricted to the payment owner, their representative,
or an administrator; unrelated users remain forbidden.
"""
import ast
import inspect
import textwrap

from app.dominio.cedula import cedula_valida
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import (
    crear_membresia_api,
    crear_persona_api,
    crear_tipo_membresia_api,
    registrar_pago_api,
)


def _autenticar_como(persona_id, roles):
    """Sobrescribe el token del cliente de test (mismo truco que
    `_autenticar_como` en test_ownership_pagos.py)."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def test_admin_puede_registrar_pago_efectivo_de_otra_persona(client):
    """Token del conftest: ADMINISTRADOR persona_id=1, distinto del dueño."""
    crear_persona_api(client, cedula=cedula_valida(240))  # relleno -> id=1 (el admin)
    persona = crear_persona_api(client, cedula="1710034073")  # id=2
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    resp = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO"
    )
    assert resp.status_code == 201, resp.text


def test_usuario_sin_vinculo_no_puede_registrar_pago_efectivo_ajeno(client):
    """La excepción para administradores no autoriza a terceros sin vínculo."""
    tercero = crear_persona_api(client, cedula=cedula_valida(240))
    persona = crear_persona_api(client, cedula="1710034073")
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    _autenticar_como(tercero["id"], ["ALUMNO"])
    resp = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO"
    )
    assert resp.status_code == 403, resp.text


def test_duenio_si_puede_registrar_su_propio_pago_efectivo(client):
    """El propio socio declarando su pago en efectivo sigue permitido."""
    persona = crear_persona_api(client, cedula="1710034073")
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO"
    )
    assert resp.status_code == 201, resp.text


def test_representante_si_registra_pago_efectivo_de_su_representado(client):
    """E04-RF003: el representante paga -- y declara -- por su representado."""
    representante = crear_persona_api(client, cedula=cedula_valida(241))  # id=1
    hijo = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado",
            "cedula": cedula_valida(242), "fecha_nacimiento": "2015-05-14",
            "telefono": "0991234567",
            "representante_id": representante["id"],
        },
    ).json()  # id=2
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, hijo["id"], tipo["id"])

    _autenticar_como(representante["id"], ["REPRESENTANTE"])
    resp = registrar_pago_api(
        client, hijo["id"], membresia["id"], tipo_pago="EFECTIVO"
    )
    assert resp.status_code == 201, resp.text


# --- Candado estructural (issue #823) ---------------------------------------
#
# Los cuatro tests de arriba fijan la regla decidida en #565 y pasan. Lo que
# NO detectan es una regla de autorización escrita, comentada y citada que
# nunca se ejecuta: si el cuerpo de un `raise` es inalcanzable, ningún test de
# comportamiento se pone rojo cuando la regla se apaga. Eso fue exactamente
# #823 -- una rama cuya condición era la negación exacta de la guarda de
# arriba, con cero cobertura y tres comentarios afirmando que estaba viva.
#
# El candado no busca un mensaje concreto: busca la FORMA del defecto, para
# que una reintroducción con otro texto también lo dispare.


def _nombres_negados(prueba: ast.expr) -> set[str]:
    """Nombres que aparecen como `not x` en una conjunción de nivel superior."""
    operandos = (
        prueba.values
        if isinstance(prueba, ast.BoolOp) and isinstance(prueba.op, ast.And)
        else [prueba]
    )
    return {
        operando.operand.id
        for operando in operandos
        if isinstance(operando, ast.UnaryOp)
        and isinstance(operando.op, ast.Not)
        and isinstance(operando.operand, ast.Name)
    }


def _nombres_garantizados_por(prueba: ast.expr) -> set[str]:
    """Nombres de una guarda `not (a or b or c)`.

    Cuando esa guarda corta con un `raise`, después de ella al menos uno de
    esos nombres es verdadero. Conjunto vacío si la condición no tiene esa
    forma (no se afirma nada que no se pueda probar del AST)."""
    if not (isinstance(prueba, ast.UnaryOp) and isinstance(prueba.op, ast.Not)):
        return set()
    interno = prueba.operand
    if not (isinstance(interno, ast.BoolOp) and isinstance(interno.op, ast.Or)):
        return set()
    if not all(isinstance(valor, ast.Name) for valor in interno.values):
        return set()
    return {valor.id for valor in interno.values}


def test_registrar_pago_no_conserva_ramas_de_autorizacion_inalcanzables():
    """Ninguna rama de `registrar_pago` puede exigir simultáneamente la
    falsedad de TODOS los flags que una guarda anterior ya garantizó -- esa
    condición es la negación exacta de lo asegurado y nunca puede ser cierta.

    Una regla de autorización inalcanzable es peor que ninguna: se lee como
    una defensa activa, se cita en comentarios y no protege nada."""
    fuente = textwrap.dedent(inspect.getsource(PagoServicio.registrar_pago))
    funcion = ast.parse(fuente).body[0]

    # Flags que, en este punto del cuerpo, ya se sabe que no pueden ser todos
    # falsos. Una reasignación posterior los devuelve al terreno de lo
    # desconocido y los saca del conjunto.
    garantizados: set[str] = set()

    for sentencia in funcion.body:
        if isinstance(sentencia, ast.If):
            if garantizados and garantizados <= _nombres_negados(sentencia.test):
                assert False, (
                    f"La rama en la línea {sentencia.lineno} de `registrar_pago` "
                    f"exige `not` sobre {sorted(garantizados)}, que la guarda "
                    "anterior ya garantizó que no pueden ser todos falsos: es "
                    "inalcanzable por construcción y no aplica ninguna regla."
                )
            if any(isinstance(nodo, ast.Raise) for nodo in sentencia.body):
                garantizados |= _nombres_garantizados_por(sentencia.test)

        for nodo in ast.walk(sentencia):
            if isinstance(nodo, ast.Assign):
                garantizados -= {
                    objetivo.id
                    for objetivo in nodo.targets
                    if isinstance(objetivo, ast.Name)
                }
