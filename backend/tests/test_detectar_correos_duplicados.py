"""Gate de pre-deploy, de solo lectura (issue #1016, ADR-4).

Reusa `detectar_colisiones` de `scripts/auditar_colisiones_correo.py`
(issue #902) -- misma consulta, mismo criterio de colisión, una sola
implementación. La diferencia con esa auditoría es el CÓDIGO DE SALIDA:
una auditoría informa siempre con 0 (una colisión es un resultado
esperado a revisar); este script existe para bloquear un pipeline de
deploy, así que tiene que poder fallar.

`codigo_de_salida` se prueba aparte de I/O/sesión real -- misma separación
que `remediar_cuenta`/`formatear` en `scripts/remediar_rol_multiple.py`:
la decisión es una función pura sobre el `dict` que ya devuelve
`detectar_colisiones` (cubierto en `tests/test_auditar_colisiones_correo.py`),
no algo que este archivo necesite volver a probar contra Postgres."""
from scripts.detectar_correos_duplicados import codigo_de_salida


def test_sin_colisiones_sale_en_cero():
    resultado = {"buckets_en_colision": 0, "usuarios_en_colision": 0, "buckets": []}
    assert codigo_de_salida(resultado) == 0


def test_con_colisiones_sale_distinto_de_cero():
    resultado = {
        "buckets_en_colision": 1,
        "usuarios_en_colision": 2,
        "buckets": [{"huella": "abc", "cantidad": 2, "ids": [1, 2], "activos": [True, False]}],
    }
    assert codigo_de_salida(resultado) != 0
