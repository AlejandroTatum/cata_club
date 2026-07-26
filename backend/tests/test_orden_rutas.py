"""
Orden de declaración de rutas en `personas_router`.

FastAPI/Starlette resuelve rutas en el orden en que se registran. `GET
/personas/{persona_id}` es un patrón genérico de un solo segmento, así que
captura cualquier ruta literal de un segmento declarada DESPUÉS y la intenta
parsear como `int` -> 422.

El propio router documenta esta trampa dos veces (en `/reportes/...` y en
`/entrenadores`), pero `/instituciones` quedó declarado al final del archivo
y cayó justo en ella. El síntoma en producto no es un error visible: las tres
pantallas que consumen el selector de institución educativa lo esconden con
`instituciones.length > 0`, así que el campo simplemente desaparecía del
formulario sin decir nada.
"""


def test_instituciones_no_es_capturada_por_persona_id(client):
    """El selector de institución educativa del wizard de inscripción."""
    respuesta = client.get("/api/v1/personas/instituciones")
    assert respuesta.status_code == 200
    assert isinstance(respuesta.json(), list)


def test_ninguna_ruta_literal_queda_despues_del_comodin():
    """Guardia estructural: evita que vuelva a pasar con otra ruta.

    Recorre las rutas de `personas_router` en su orden de declaración y
    verifica que ninguna ruta literal de un solo segmento quede después del
    comodín `/{persona_id}`, que la dejaría inalcanzable. Se inspecciona el
    router y no `app.routes` porque esta versión de FastAPI conserva los
    routers incluidos sin aplanarlos.
    """
    from app.presentacion.routers import personas_router

    rutas = [r.path for r in personas_router.router.routes]
    comodin = "/personas/{persona_id}"
    indice_comodin = rutas.index(comodin)

    # Una ruta queda tapada si es literal (sin parametros) y tiene la misma
    # cantidad de segmentos que el comodin.
    segmentos_comodin = comodin.count("/")
    literales_tapadas = [
        ruta for ruta in rutas[indice_comodin + 1:]
        if "{" not in ruta and ruta.count("/") == segmentos_comodin
    ]
    assert literales_tapadas == [], (
        f"Estas rutas literales quedaron despues de '{comodin}' y son "
        f"inalcanzables: {literales_tapadas}"
    )
