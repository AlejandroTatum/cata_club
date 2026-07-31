"""
Excepciones de negocio. Viven en el dominio porque representan violaciones
de reglas del negocio, no detalles de infraestructura ni de HTTP.

La capa de presentación (routers) NUNCA lanza estas excepciones directamente;
las lanzan los servicios_negocio. Un manejador global en main.py las traduce
al código HTTP correspondiente, así los routers no necesitan try/except.
"""


class ErrorDominio(Exception):
    """Excepción base para toda regla de negocio violada."""
    def __init__(self, mensaje: str):
        self.mensaje = mensaje
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
