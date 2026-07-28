"""
Concurrencia real sobre el upsert idempotente de nivel
(`RankingServicio.asignar_nivel`, detrás de `PATCH /personas/{id}/nivel`).

`Ranking.persona_id` es UNIQUE. El servicio lee la fila y, si no existe, la
inserta: dos peticiones simultáneas para la MISMA persona sin fila previa leen
las dos `None`, insertan las dos y la que pierde choca contra el índice único.
Sin manejo, ese choque sale como `IntegrityError` crudo -- que `main.py` no
mapea a ningún código HTTP -- y el cliente recibe un 500. Eso contradice
exactamente el contrato que el endpoint anuncia: que la operación es
idempotente y que el que llama no tiene por qué saber en qué estado estaba el
alumno.

POR QUÉ ESTAS PRUEBAS NO USAN `client` NI `db_session`:

La fixture `db_session` da UNA sesión sobre UNA conexión dentro de una
transacción externa que nunca se commitea (aislamiento por savepoints), y
`TestClient` es síncrono y comparte esa misma sesión en todas las peticiones.
Con eso no hay carrera posible: no hay dos transacciones. Así que estas
pruebas abren sesiones independientes sobre `motor_test`, commitean de verdad
y limpian sus filas en el `finally` de la fixture. Es concurrencia genuina:
dos hilos, dos conexiones, el índice único de Postgres real arbitrando.

La carrera se vuelve determinística con una `threading.Barrier` en `crear`:
los dos hilos ya leyeron `None` cuando llegan ahí, así que insertan a la vez.
Sin la barrera el resultado dependería del scheduler.
"""
import threading
from datetime import date

import pytest
from sqlalchemy.orm import Session

from app.dominio.modelos import NivelRanking, Persona, Ranking
from app.infraestructura.repositorios import ranking_repositorio
from app.servicios_negocio.ranking_servicio import RankingServicio


@pytest.fixture()
def escenario_concurrente(motor_test):
    """Persona + dos niveles COMMITEADOS de verdad (no dentro de la
    transacción de un test), que es lo único que dos conexiones distintas
    pueden ver a la vez. Devuelve `(persona_id, nivel_a_id, nivel_b_id)`.

    La limpieza borra las filas al terminar para que las pruebas que sí usan
    `db_session` -- y que reinician las secuencias a 1 dentro de su propia
    transacción -- no se topen con ids ya ocupados.
    """
    sesion = Session(bind=motor_test)
    nivel_a = NivelRanking(numero_nivel=901, nombre="Concurrencia A")
    nivel_b = NivelRanking(numero_nivel=902, nombre="Concurrencia B")
    persona = Persona(
        nombres="Carrera", apellidos="Simultánea", cedula="1799000901",
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000901",
    )
    sesion.add_all([nivel_a, nivel_b, persona])
    sesion.commit()
    ids = (persona.id, nivel_a.id, nivel_b.id)
    sesion.close()

    try:
        yield ids
    finally:
        limpieza = Session(bind=motor_test)
        limpieza.query(Ranking).filter(Ranking.persona_id == ids[0]).delete()
        limpieza.query(Persona).filter(Persona.id == ids[0]).delete()
        limpieza.query(NivelRanking).filter(
            NivelRanking.id.in_([ids[1], ids[2]])
        ).delete(synchronize_session=False)
        limpieza.commit()
        limpieza.close()


def _correr_dos_asignaciones_en_paralelo(
    motor_test, persona_id: int, destino_hilo_1, destino_hilo_2
) -> list:
    """Dispara dos `asignar_nivel` a la vez sobre la misma persona.

    Devuelve una lista de dos elementos: el `Ranking` devuelto por cada hilo,
    o la excepción que ese hilo dejó escapar.
    """
    barrera = threading.Barrier(2, timeout=15)
    leer_original = ranking_repositorio.RankingRepositorio.obtener_por_persona
    local = threading.local()

    def leer_sincronizado(self, persona_id):
        fila = leer_original(self, persona_id)
        # Solo la PRIMERA lectura de cada hilo espera: es la que decide "no
        # hay fila". Que los dos hilos salgan de ahí a la vez es lo que hace
        # la carrera determinística en vez de dependiente del scheduler. La
        # relectura posterior del que pierda NO puede quedarse esperando a
        # nadie, así que no vuelve a tocar la barrera.
        if not getattr(local, "ya_espero", False):
            local.ya_espero = True
            barrera.wait()
        return fila

    resultados: list = [None, None]

    def trabajo(indice: int, destino):
        sesion = Session(bind=motor_test)
        try:
            resultados[indice] = RankingServicio(sesion).asignar_nivel(persona_id, destino)
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[indice] = error
            # Un hilo que muere sin insertar dejaría al otro colgado en la
            # barrera hasta el timeout.
            barrera.abort()
        finally:
            sesion.close()

    ranking_repositorio.RankingRepositorio.obtener_por_persona = leer_sincronizado
    try:
        hilos = [
            threading.Thread(target=trabajo, args=(0, destino_hilo_1)),
            threading.Thread(target=trabajo, args=(1, destino_hilo_2)),
        ]
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=30)
    finally:
        ranking_repositorio.RankingRepositorio.obtener_por_persona = leer_original

    return resultados


def _niveles_persistidos(motor_test, persona_id: int) -> list:
    sesion = Session(bind=motor_test)
    try:
        filas = sesion.query(Ranking).filter(Ranking.persona_id == persona_id).all()
        return [(fila.id, fila.nivel_ranking_id) for fila in filas]
    finally:
        sesion.close()


def test_dos_asignaciones_simultaneas_al_mismo_nivel_no_rompen(
    motor_test, escenario_concurrente
):
    """El caso base de la carrera: nadie tiene fila y los dos piden el mismo
    nivel. Las dos peticiones tienen que terminar bien (la operación es
    idempotente por contrato) y tiene que quedar UNA sola fila."""
    persona_id, nivel_a_id, _ = escenario_concurrente

    resultados = _correr_dos_asignaciones_en_paralelo(
        motor_test, persona_id, nivel_a_id, nivel_a_id
    )

    assert not any(isinstance(r, BaseException) for r in resultados), (
        f"una de las dos peticiones concurrentes falló: {resultados}"
    )
    assert all(r.nivel_ranking_id == nivel_a_id for r in resultados)
    assert _niveles_persistidos(motor_test, persona_id) == [
        (resultados[0].id, nivel_a_id)
    ]


def test_asignar_y_quitar_simultaneos_no_rompen(motor_test, escenario_concurrente):
    """El par que marcó la revisión: una petición con nivel y otra con `null`,
    a la vez, sobre una persona sin fila. Ninguna de las dos puede reventar, y
    el estado final tiene que ser UNA fila con uno de los dos destinos pedidos
    (no un tercero, ni dos filas)."""
    persona_id, nivel_a_id, _ = escenario_concurrente

    resultados = _correr_dos_asignaciones_en_paralelo(
        motor_test, persona_id, nivel_a_id, None
    )

    assert not any(isinstance(r, BaseException) for r in resultados), (
        f"una de las dos peticiones concurrentes falló: {resultados}"
    )
    persistidas = _niveles_persistidos(motor_test, persona_id)
    assert len(persistidas) == 1
    assert persistidas[0][1] in (nivel_a_id, None)


def test_la_fila_creada_por_otra_transaccion_se_reutiliza_en_vez_de_duplicar(
    motor_test, escenario_concurrente
):
    """La misma carrera, escrita sin hilos: la fila competidora aparece
    (commiteada por otra sesión) ENTRE la lectura y la escritura. Es el
    escenario mínimo que reproduce el fallo, y deja explícito que el arreglo
    no depende del scheduler."""
    persona_id, nivel_a_id, nivel_b_id = escenario_concurrente

    sesion_perdedora = Session(bind=motor_test)
    sesion_ganadora = Session(bind=motor_test)
    leer_original = ranking_repositorio.RankingRepositorio.obtener_por_persona
    ya_intercalado = False

    def leer_con_competidor(self, id_de_persona):
        nonlocal ya_intercalado
        fila = leer_original(self, id_de_persona)
        # Justo DESPUÉS de que el servicio comprobó que no hay fila, otra
        # sesión commitea la suya. Es exactamente la ventana de la carrera.
        if not ya_intercalado:
            ya_intercalado = True
            sesion_ganadora.add(
                Ranking(persona_id=persona_id, nivel_ranking_id=nivel_b_id)
            )
            sesion_ganadora.commit()
        return fila

    ranking_repositorio.RankingRepositorio.obtener_por_persona = leer_con_competidor
    try:
        resultado = RankingServicio(sesion_perdedora).asignar_nivel(
            persona_id, nivel_a_id
        )
    finally:
        ranking_repositorio.RankingRepositorio.obtener_por_persona = leer_original
        sesion_perdedora.close()
        sesion_ganadora.close()

    assert resultado.nivel_ranking_id == nivel_a_id
    assert _niveles_persistidos(motor_test, persona_id) == [(resultado.id, nivel_a_id)]
