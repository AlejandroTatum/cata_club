"""ADMB-12, ADMB-10/11, ENT-16: los 422 y los errores de archivo llegan en castellano llano."""
import pytest

from app.servicios_negocio.mensajes_validacion import mensaje_con_tamano_en_mb

RUTA_TARIFAS = "/api/v1/membresias/tipos"
RUTA_DESCUENTOS = "/api/v1/descuentos/"
RUTA_GALERIA = "/api/v1/galeria/"


@pytest.mark.parametrize(
    "ruta, cuerpo, esperado",
    [
        (RUTA_DESCUENTOS, {"nombre": "X", "monto": 100000}, "El monto no puede ser mayor que $1000,00."),
        (RUTA_DESCUENTOS, {"nombre": "X", "monto": 0.5}, "El monto debe ser de $1,00 o más."),
        (RUTA_DESCUENTOS, {"nombre": "X", "porcentaje": 0.001}, "Usa hasta 2 decimales (por ejemplo 0,5)."),
        (RUTA_DESCUENTOS, {"nombre": "X", "porcentaje": 0}, "El valor debe ser mayor que 0."),
        (RUTA_DESCUENTOS, {"nombre": "X", "porcentaje": 101}, "El valor no puede ser mayor que 100."),
        (RUTA_DESCUENTOS, {"porcentaje": 5}, "Este campo es obligatorio."),
        (RUTA_DESCUENTOS, {"nombre": "x" * 101, "porcentaje": 5}, "Usa hasta 100 caracteres."),
    ],
)
def test_los_422_de_descuentos_salen_en_castellano(client, ruta, cuerpo, esperado):
    respuesta = client.post(ruta, json=cuerpo)

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == esperado


def test_tarifa_por_debajo_del_minimo_dice_cuanto_es_el_minimo(client):
    respuesta = client.post(RUTA_TARIFAS, json={"categoria": "X", "precio": 0.5, "modalidad": "MENSUAL"})

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == "El precio debe ser de $1,00 o más."


def test_modalidad_invalida_pide_elegir_una_opcion(client):
    respuesta = client.post(RUTA_TARIFAS, json={"categoria": "X", "precio": 5, "modalidad": "NADA"})

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == "Elige una opción válida de la lista."


def test_un_valor_error_propio_conserva_su_texto_sin_prefijo(client):
    respuesta = client.post(RUTA_DESCUENTOS, json={"nombre": "X"})

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == "El descuento debe definir exactamente uno: porcentaje o monto fijo"


def test_el_limite_de_tamano_se_informa_en_megabytes():
    assert mensaje_con_tamano_en_mb(
        "El archivo excede el tamaño máximo permitido de 5242880 bytes"
    ) == "El archivo pesa más de 5 MB. Elige uno más liviano."
    assert mensaje_con_tamano_en_mb("Otro mensaje") == "Otro mensaje"


def test_lote_de_asistencias_vacio_pide_al_menos_un_alumno(client):
    respuesta = client.post(
        "/api/v1/asistencias/lote",
        json={"horario_id": 1, "fecha": "2026-08-10", "items": []},
    )

    assert respuesta.status_code == 422
    assert respuesta.json()["detail"] == "Debes enviar al menos un jugador."
