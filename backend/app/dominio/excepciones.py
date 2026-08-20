"""
Excepciones de negocio. Viven en el dominio porque representan violaciones
de reglas del negocio, no detalles de infraestructura ni de HTTP.

La capa de presentación (routers) NUNCA lanza estas excepciones directamente;
las lanzan los servicios_negocio. Un manejador global en main.py las traduce
al código HTTP correspondiente, así los routers no necesitan try/except.
"""


class ErrorDominio(Exception):
    """Excepción base para toda regla de negocio violada.

    Lleva DOS textos, y esa es una decisión de diseño, no una comodidad.

    `mensaje` es lo que sale por la API y lo lee un socio del club.
    `detalle_tecnico` es lo que se registra en el log y lo lee quien diagnostica.

    El motivo de que sean dos: reescribir "el alumno 47 ya está asignado al
    horario 12" como "Martín Vera ya figura en ese horario" mejora lo que lee
    la persona y a la vez BORRA los dos identificadores con los que se
    reproduce el caso. Con un solo campo hay que elegir a quién dejar sin
    información -- al socio, que no sabe qué es un `horario_id`, o a quien
    revisa el log, que necesita justamente eso. Con dos campos no hay que
    elegir: el socio lee una frase y el log conserva los ids.

    `detalle_tecnico` es opcional a propósito. La mayoría de los mensajes no
    pierden nada al escribirse bien ("El menor requiere un representante
    legal" no oculta ningún dato), y exigirlo siempre llenaría el log de
    líneas que repiten el mensaje con otras palabras.

    Lo registra el manejador global de `main.py`, así ningún servicio tiene
    que acordarse de loguear.

    `seguro_mostrar` (issue #355) es el candado que abre la excepción,
    keyword-only para que nadie lo pase por accidente en la posición de
    `detalle_tecnico`. Por defecto es `False`: el manejador global de
    `main.py` descarta `mensaje` en cualquier 5xx salvo que el sitio que
    lanza la excepción marque explícitamente que ESE texto es seguro para
    mostrar tal cual -- fail closed, así una excepción nueva no puede filtrar
    nada por omisión.
    """
    def __init__(
        self,
        mensaje: str,
        detalle_tecnico: str | None = None,
        *,
        seguro_mostrar: bool = False,
    ):
        self.mensaje = mensaje
        self.detalle_tecnico = detalle_tecnico
        self.seguro_mostrar = seguro_mostrar
        super().__init__(mensaje)


class EntidadNoEncontrada(ErrorDominio):
    """Se solicitó una entidad que no existe (-> HTTP 404)."""
    pass


class EntidadDuplicada(ErrorDominio):
    """Violación de unicidad, ej. cédula o correo repetido (-> HTTP 400)."""
    pass


class OperacionInvalida(ErrorDominio):
    """La operación viola una regla de negocio, ej. horario inválido (-> HTTP 400)."""
    pass


class CredencialesInvalidas(ErrorDominio):
    """Login fallido (-> HTTP 401)."""
    pass


class PermisosInsuficientes(ErrorDominio):
    """El usuario autenticado no tiene el rol requerido (-> HTTP 403)."""
    pass


class ServicioNoDisponible(ErrorDominio):
    """Una dependencia necesaria para completar la operación no respondió,
    ej. el broker de tareas al encolar un envío de correo (-> HTTP 503)."""
    pass


class ConflictoConcurrencia(ErrorDominio):
    """Dos operaciones concurrentes compitieron por la misma fila y el
    `lock_timeout` de Postgres venció esperando su turno (-> HTTP 409, issue
    #451). Distinta de `OperacionInvalida`/`EntidadDuplicada` (400): acá no
    hay ningún dato inválido -- es puro timing, y reintentar sin cambiar
    nada suele alcanzar. Ver `app/soporte_transversal/bloqueo_fila.py`."""
    pass
