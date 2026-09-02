"""DTOs de la capa de aplicacion (issue #829).

Los modulos de este paquete son el contrato que `servicios_negocio` recibe
y devuelve: DTOs Pydantic con sus validadores (cedula, telefono, nombre),
consumidos tanto por los routers de la capa web como por cualquier llamador
que no pase por HTTP (por ejemplo, las tareas de Celery). Antes vivian en
los schemas de la capa web, lo que obligaba a la capa de aplicacion a
depender de ella solo para construir sus propias respuestas (#829).
"""
