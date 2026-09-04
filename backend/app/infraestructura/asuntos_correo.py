"""Asuntos de correo transaccional, en un módulo sin dependencias.

`scripts/qa_verify_recovery_delivery.py` corre con `python3` puro desde la
raíz del repo, sin el venv de `backend` (ver `Makefile`), así que este
módulo no puede importar nada de `app` ni de terceros: el script lo carga
por ruta de archivo (`importlib.util.spec_from_file_location`), no como
paquete. `notificaciones_servicio.py` lo importa normalmente.

El asunto vivía duplicado como literal en el backend y en el script de QA
(issue #1010): el PR #984 cambió uno y no el otro, y el test del script
quedó verde porque sus fixtures repetían el mismo literal viejo. Esta
constante es la única fuente; nada más la copia.
"""

ASUNTO_RECUPERACION = "Cata Club | Recuperación de contraseña"
