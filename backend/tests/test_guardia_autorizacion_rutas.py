"""
Guardia estructural de autorizacion (REQ-SEC-2).

`test_orden_rutas.py` ya probo que caminar `router.routes` y afirmar una
propiedad estructural detecta bugs de ruteo antes de produccion. Este archivo
aplica la misma idea a autorizacion: recorre TODAS las rutas de la app real y
clasifica cada una en exactamente un balde:

  RUTAS_PUBLICAS            -- sin NINGUNA dependencia de auth (anonimo).
  RUTAS_SOLO_AUTENTICADAS   -- exige token valido pero ningun rol declarado
                                (`GestorPermisos`). Cubre dos casos legitimos
                                distintos, ambos ya documentados en el propio
                                router con un comentario: datos de catalogo
                                sin PII (ej. `GET /asistencias/horarios`), o
                                ownership verificado DENTRO del handler via
                                `PoliticaAccesoPersona` (ej. `GET
                                /personas/{persona_id}`).
  (todo lo demas)           -- DEBE declarar `GestorPermisos([...])`; se
                                verifica ademas el conjunto exacto de roles
                                contra `RUTAS_ROLES_REQUERIDOS`.

Por que un guardia estructural y no un middleware default-deny: el caso que
motiva este archivo (`GET /asistencias/horarios/{id}/alumnos`, SEC-1) tenia
SOLO `decodificar_token` declarado -- un middleware que inspeccionara
dependencias declaradas lo habria visto identico a cualquier ruta
legitimamente "solo autenticada" como `GET /asistencias/horarios`. La
autorizacion real de las rutas ownership-gated vive DENTRO del cuerpo del
handler (`PoliticaAccesoPersona(db).exigir_acceso(...)`, ver
`asistencias_router.py:205`), invisible para cualquier inspector de
dependencias. Lo unico que S/ funciona es congelar el estado actual en un
listado literal y revisable en diff: agregar una ruta nueva sin rol la deja
fuera de los tres conjuntos de abajo y este test la revienta.

Sembrado desde el barrido confirmado en `sdd/production-readiness/spec`
(tabla REQ-SEC-2) mas una corrida real de introspeccion sobre `main.app`.
"""
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.gestor_permisos import GestorPermisos


def _rutas_declaradas():
    """Camina el arbol de rutas de la app real, recursando dentro de los
    routers incluidos. Esta version de FastAPI NO aplana `app.include_router`
    dentro de `app.routes` -- cada router incluido queda envuelto en un
    `_IncludedRouter` cuyo `.original_router.routes` tiene las rutas reales
    (mismo hallazgo que documenta `test_orden_rutas.py` para
    `personas_router.router.routes`). Recorre de forma recursiva y tolera
    ambas formas por si una version futura de FastAPI vuelve a aplanar."""
    from main import app

    def _caminar(rutas):
        for ruta in rutas:
            if hasattr(ruta, "dependant"):
                yield ruta
            elif hasattr(ruta, "original_router"):
                yield from _caminar(ruta.original_router.routes)
            elif hasattr(ruta, "routes"):
                yield from _caminar(ruta.routes)

    yield from _caminar(app.routes)


def _clasificar_rutas():
    """Devuelve `(publicas, solo_autenticadas, roles_requeridos)` a partir
    del estado REAL de la app -- nunca de una copia estatica del codigo."""
    publicas = set()
    solo_autenticadas = set()
    roles_requeridos = {}

    for ruta in _rutas_declaradas():
        metodos = sorted(ruta.methods - {"HEAD", "OPTIONS"})
        assert len(metodos) == 1, (
            f"Ruta con multiples metodos HTTP reales, este guardia asume "
            f"uno solo por ruta: {ruta.path} -> {metodos}"
        )
        clave = (metodos[0], ruta.path)

        gestor_permisos = None
        requiere_token = False
        for dep in ruta.dependant.dependencies:
            if isinstance(dep.call, GestorPermisos):
                gestor_permisos = dep.call
            elif dep.call is GestorAutenticacion.decodificar_token:
                requiere_token = True

        if gestor_permisos is not None:
            roles_requeridos[clave] = frozenset(gestor_permisos.roles_requeridos)
        elif requiere_token:
            solo_autenticadas.add(clave)
        else:
            publicas.add(clave)

    return publicas, solo_autenticadas, roles_requeridos


# --- Balde 1: sin ninguna dependencia de auth --------------------------
# Login/registro/recuperacion de clave y autoinscripcion son, por diseño,
# el punto de entrada anonimo. `/auth/refresh` tambien: el refresh token
# viaja en el body, no en el header Authorization. `/geografia/*` GET y
# `/personas/instituciones` son catalogo puro (paises/provincias/cantones/
# instituciones educativas) sin dato de persona alguno.
RUTAS_PUBLICAS = {
    ("GET", "/"),
    ("GET", "/health"),  # liveness probe (PR-09, sdd/production-readiness): sin
                         # dependencias a proposito, debe responder aunque la BD
                         # este caida (lo usa el healthcheck de docker-compose.yml).
    ("GET", "/health/ready"),  # readiness probe (PR2, sdd/borde-http-observable):
                               # comprueba PostgreSQL y Redis y responde 503 si
                               # alguna esta caida. Anonima a proposito, por el
                               # mismo motivo que /health: una sonda que exige
                               # token no sirve cuando lo que se cayo es la BD
                               # de la que depende autenticar. No expone dato
                               # alguno mas alla del estado up/down de cada
                               # dependencia.
    ("GET", "/personas/instituciones"),
    ("POST", "/auth/login"),
    ("POST", "/auth/recuperar-contrasenia"),
    ("POST", "/auth/refresh"),
    ("POST", "/auth/restablecer-contrasenia"),
    ("POST", "/chatbot/consultar"),
    ("POST", "/enrollment/"),
}


# --- Balde 2: exige token valido, sin rol declarado ---------------------
# Cada entrada cae en uno de dos casos, ya documentados con comentario en el
# router correspondiente:
#   (a) catalogo/lectura no sensible para cualquier autenticado
#       (horarios, tipos de membresia, geografia -- fijado por REQ-SEC-2 en
#       esta misma PR).
#   (b) ownership verificado DENTRO del handler via `PoliticaAccesoPersona`
#       o un chequeo equivalente contra `token_payload["persona_id"]`.
RUTAS_SOLO_AUTENTICADAS = {
    ("GET", "/asistencias/alumnos/{persona_id}/horarios"),      # (b)
    ("GET", "/asistencias/categorias"),                          # (a)
    ("GET", "/asistencias/horarios"),                           # (a)
    ("GET", "/asistencias/persona/{persona_id}"),                # (b)
    ("GET", "/auth/me"),                                         # (b) - propio via `sub`
    ("POST", "/auth/logout"),                                    # (b) - propio via `sub`, TRA-10
    ("GET", "/fichas-medicas/persona/{persona_id}"),             # (b) - admin o representante, SIN el titular
    ("GET", "/geografia/cantones"),                              # (a)
    ("GET", "/geografia/cantones/{canton_id}"),                  # (a)
    ("GET", "/geografia/paises"),                                # (a)
    ("GET", "/geografia/paises/{pais_id}"),                      # (a)
    ("GET", "/geografia/provincias"),                            # (a)
    ("GET", "/geografia/provincias/{provincia_id}"),             # (a)
    ("GET", "/membresias/mias"),                                 # (b)
    ("GET", "/membresias/pagos/persona/{persona_id}"),           # (b)
    ("GET", "/membresias/pagos/{pago_id}"),                      # (b)
    ("GET", "/membresias/persona/{persona_id}"),                 # (b)
    ("GET", "/auth/me/sesiones"),                                # (b) - propio via `sub`, nunca un id de path
    ("GET", "/membresias/tipos"),                                # (a)
    ("GET", "/membresias/{membresia_id}"),                       # (b)
    ("GET", "/personas/buscar"),                                 # (a) - autocomplete, no PII sensible expuesta en el DTO
    ("GET", "/personas/{persona_id}"),                           # (b)
    ("GET", "/personas/{persona_id}/antecedentes-club"),         # (b)
    ("GET", "/personas/{persona_id}/representados"),             # (b)
    ("GET", "/ranking/notificaciones/mias"),                     # (b) - propio via `persona_id` del token
    ("PATCH", "/auth/me"),                                       # (b) - propio via `sub`
    ("PATCH", "/fichas-medicas/persona/{persona_id}"),           # (b) - admin o representante, SIN el titular
    ("PATCH", "/ranking/notificaciones/{notificacion_id}/leer"), # (b) - propio via `persona_id` del token
    ("POST", "/auth/me/foto"),                                   # (b) - propio via `sub`
    ("POST", "/auth/sesiones/invalidar"),                        # (b) - propio via `sub`
    ("POST", "/membresias/pagos"),                                # (b) - dueño/admin validado en el servicio
    ("POST", "/membresias/pagos/{pago_id}/voucher"),             # (b) - dueño/admin validado en el servicio
    ("POST", "/personas/{persona_id}/independizar"),             # (b)
    ("POST", "/personas/{persona_id}/foto"),                      # (b) - dueño/representante/admin validado en el router
}


# --- Balde 3: todo lo demas DEBE declarar `GestorPermisos([...])` -------
# El conjunto exacto de roles queda congelado aca: cambiar el rol de una
# ruta existente, o agregar una ruta nueva con roles distintos a los ya
# usados en su vecindario, es una decision que este test obliga a hacer
# visible en el diff.
RUTAS_ROLES_REQUERIDOS = {
    ("DELETE", "/asistencias/desasignar-alumno"): frozenset({"ADMINISTRADOR", "ENTRENADOR"}),
    # ABM de categorías (docs/archive/fixes/24-abm-categorias.md): alta/edición/baja
    # atómica de la categoria + sus días + sus horarios. Mismo tier que
    # PUT/DELETE de `/horarios` (ADMIN-only), no el más permisivo POST
    # /horarios (que además admite ENTRENADOR) -- crear una categoria
    # entera es una decisión de catálogo, no operar la clase del día.
    ("POST", "/asistencias/categorias"): frozenset({"ADMINISTRADOR"}),
    ("PUT", "/asistencias/categorias/{codigo}"): frozenset({"ADMINISTRADOR"}),
    ("DELETE", "/asistencias/categorias/{codigo}"): frozenset({"ADMINISTRADOR"}),
    ("DELETE", "/asistencias/horarios/{horario_id}"): frozenset({"ADMINISTRADOR"}),
    # `DELETE /personas/{persona_id}` ya no existe: la baja de una persona es
    # LÓGICA (`PATCH /personas/{persona_id}/estado`, más abajo), porque el
    # borrado duro destruía asistencias, pagos y ficha médica del ex-miembro.
    ("DELETE", "/personas/{persona_id}/roles/{tipo_rol}"): frozenset({"ADMINISTRADOR"}),
    # Issue #398: retirar el beneficio del club es ADMINISTRADOR-only, igual
    # que asignarlo (ver sus hermanos GET/POST más abajo).
    ("DELETE", "/personas/{persona_id}/beneficio"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/asistencias/horarios/alumnos"): frozenset({"ADMINISTRADOR", "ENTRENADOR"}),
    ("GET", "/asistencias/horarios/{horario_id}/alumnos"): frozenset({"ADMINISTRADOR", "ENTRENADOR"}),
    ("GET", "/asistencias/reportes"): frozenset({"ADMINISTRADOR", "ENTRENADOR"}),
    ("GET", "/asistencias/reportes/pdf"): frozenset({"ADMINISTRADOR"}),
    # Fix 8 / DSH-2: "últimas listas del club" en el panel del entrenador.
    # Mismo tier que su hermano `/reportes`: ninguno de los dos roles
    # necesita el nombre de un alumno para esta tarjeta.
    ("GET", "/asistencias/ultimas-listas"): frozenset({"ADMINISTRADOR", "ENTRENADOR"}),
    ("GET", "/dashboard/stats"): frozenset({"ADMINISTRADOR"}),
    # Resumen de circuit breakers (P2, feat/diagnostico-circuitos-http): le
    # dice a quien la lea QUÉ dependencia externa está caída y CUÁNDO
    # golpear -- inteligencia operativa, no un simple up/down -- por eso
    # exige el mismo rol que el resto del panel administrativo y no vive
    # entre las sondas anónimas de /health.
    ("GET", "/diagnostico/circuitos"): frozenset({"ADMINISTRADOR"}),
    # Catálogo de descuentos (issue #11): TODO el CRUD es del ADMINISTRADOR
    # -- el catálogo es del club y la decisión de aplicar es del admin. El
    # listado incluye inactivos (vista de administración), por eso ni la
    # lectura es de "cualquier autenticado".
    ("GET", "/descuentos/"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/descuentos/{descuento_id}"): frozenset({"ADMINISTRADOR"}),
    # Issue #360: el club no asigna entrenadores a horarios, así que el
    # acceso se acota por DATO (siete campos de emergencia, no la ficha
    # completa), no por qué alumnos -- cualquier ENTRENADOR puede consultarla.
    ("GET", "/fichas-medicas/persona/{persona_id}/emergencia"): frozenset(
        {"ADMINISTRADOR", "ENTRENADOR"}
    ),
    # Issue #362: existencia en bloque para el admin `/members`. ADMIN_ONLY
    # (no ADMIN_O_ENTRENADOR como la ruta de emergencia de arriba) -- es una
    # pantalla de gestión, no una emergencia en curso.
    ("GET", "/fichas-medicas/existe"): frozenset({"ADMINISTRADOR"}),
    ("PATCH", "/descuentos/{descuento_id}"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/descuentos/"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/membresias/"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/membresias/estadisticas"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/membresias/{membresia_id}/deuda"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/membresias/pagos"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/membresias/pagos/reportes"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/membresias/pagos/reportes/pdf"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/personas/"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/personas/reportes/nuevos-por-periodo"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/personas/reportes/nuevos-por-periodo/pdf"): frozenset({"ADMINISTRADOR"}),
    # Issue #398: leer el beneficio vigente de una persona es tan sensible
    # como asignarlo (expone qué descuento y quién lo concedió) -- mismo rol
    # que sus hermanos POST/DELETE, no "cualquier autenticado".
    ("GET", "/personas/{persona_id}/beneficio"): frozenset({"ADMINISTRADOR"}),
    ("GET", "/personas/{persona_id}/roles"): frozenset({"ADMINISTRADOR"}),
    ("PATCH", "/membresias/pagos/{pago_id}/validar"): frozenset({"ADMINISTRADOR"}),
    ("PATCH", "/personas/{persona_id}"): frozenset({"ADMINISTRADOR"}),
    ("PATCH", "/personas/{persona_id}/antecedentes-club"): frozenset({"ADMINISTRADOR"}),
    ("PATCH", "/personas/{persona_id}/cuenta/estado"): frozenset({"ADMINISTRADOR"}),
    ("PATCH", "/personas/{persona_id}/estado"): frozenset({"ADMINISTRADOR"}),
    # Issue #389: corregir es un acto DISTINTO de tomar -- solo admin,
    # nunca el entrenador que puede tomar/crear via el POST de abajo.
    ("PATCH", "/asistencias/{asistencia_id}/corregir"): frozenset({"ADMINISTRADOR"}),
    # Issue #389, slice 4a: historial de correcciones -- mismo tier que
    # `corregir` (auditoría de registros que pueden ser de menores).
    ("GET", "/asistencias/{asistencia_id}/correcciones"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/asistencias/"): frozenset({"ADMINISTRADOR", "ENTRENADOR"}),
    ("POST", "/asistencias/asignar-alumno"): frozenset({"ADMINISTRADOR", "ENTRENADOR"}),
    ("POST", "/asistencias/horarios"): frozenset({"ADMINISTRADOR", "ENTRENADOR"}),
    ("POST", "/auth/registro"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/fichas-medicas/"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/geografia/cantones"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/geografia/paises"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/geografia/provincias"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/membresias/"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/membresias/{membresia_id}/regularizar-deuda"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/membresias/pagos/{pago_id}/comprobante"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/membresias/tipos"): frozenset({"ADMINISTRADOR"}),
    # Issue #394: editar una tarifa es escribir sobre el número con el que el
    # club cobra, así que lleva el mismo rol que crearla.
    ("PATCH", "/membresias/tipos/{tipo_id}"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/personas/"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/personas/admin/cuentas"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/personas/{persona_id}/antecedentes-club"): frozenset({"ADMINISTRADOR"}),
    # Issue #398: solo el club (ADMINISTRADOR) concede un beneficio -- el
    # propio beneficiario nunca puede pedirlo (ver docstring del endpoint).
    ("POST", "/personas/{persona_id}/beneficio"): frozenset({"ADMINISTRADOR"}),
    ("POST", "/personas/{persona_id}/representados"): frozenset({"ADMINISTRADOR", "REPRESENTANTE"}),
    ("POST", "/personas/{persona_id}/roles"): frozenset({"ADMINISTRADOR"}),
    # INS-2 (docs/product/decisiones-de-negocio-2026-08-11.md §1): mismo par de roles
    # que su hermano `representados` -- un representante vincula su propio
    # representado ya existente, un administrador puede hacerlo por cualquiera.
    ("POST", "/personas/{persona_id}/vincular-representado"): frozenset({"ADMINISTRADOR", "REPRESENTANTE"}),
    ("PUT", "/asistencias/horarios/{horario_id}"): frozenset({"ADMINISTRADOR"}),
}


def test_cada_ruta_declara_la_autorizacion_esperada():
    """Guardia estructural (REQ-SEC-2): toda ruta cae en exactamente uno de
    los tres baldes de arriba. Una ruta nueva con solo `decodificar_token` (o
    sin ninguna dependencia) que no se agregue explicitamente a su balde
    revienta este test -- ese es el mecanismo, no un efecto secundario."""
    publicas, solo_autenticadas, roles = _clasificar_rutas()

    faltan_en_publicas = publicas - RUTAS_PUBLICAS
    sobran_en_publicas = RUTAS_PUBLICAS - publicas
    assert publicas == RUTAS_PUBLICAS, (
        "Rutas sin NINGUNA dependencia de auth que no estan en el listado "
        f"congelado -- nuevas y sin revisar: {sorted(faltan_en_publicas)}; "
        f"listadas pero ya no existen/cambiaron: {sorted(sobran_en_publicas)}"
    )

    faltan_en_solo_auth = solo_autenticadas - RUTAS_SOLO_AUTENTICADAS
    sobran_en_solo_auth = RUTAS_SOLO_AUTENTICADAS - solo_autenticadas
    assert solo_autenticadas == RUTAS_SOLO_AUTENTICADAS, (
        "Rutas 'solo autenticado' (sin rol) que no estan en el listado "
        f"congelado -- nuevas y sin revisar: {sorted(faltan_en_solo_auth)}; "
        f"listadas pero ya no existen/cambiaron: {sorted(sobran_en_solo_auth)}"
    )

    distintas = {
        clave: (roles.get(clave), RUTAS_ROLES_REQUERIDOS.get(clave))
        for clave in set(roles) | set(RUTAS_ROLES_REQUERIDOS)
        if roles.get(clave) != RUTAS_ROLES_REQUERIDOS.get(clave)
    }
    assert roles == RUTAS_ROLES_REQUERIDOS, (
        f"Matriz de roles por ruta no coincide (actual, esperado): {distintas}"
    )


def test_geografia_rutas_requieren_autenticacion(client_sin_token):
    """REQ-SEC-2: `GET /geografia/paises` no tenia NINGUNA dependencia -- ni
    siquiera `decodificar_token` -- pese a que el propio router afirma en un
    comentario que es lectura "para cualquiera autenticado". Cualquiera,
    autenticado o no, podia leerlo hoy."""
    resp = client_sin_token.get("/api/v1/geografia/paises")
    assert resp.status_code == 401
