"""Constantes de reglas de negocio que más de una capa necesita leer.

Un valor vive acá, en vez de en `servicios_negocio` o en `presentacion`,
precisamente cuando AMBAS capas lo necesitan: `dominio` no depende de
ninguna de las dos, así que importar desde acá nunca arma un ciclo. Ver el
caso que originó este archivo justo abajo.
"""

# Issue #262, recreado desde cero para la corrección explícita del issue
# #389 (slice 2): el mecanismo previo (rol + este mismo tope) fue eliminado
# del camino de `registrar_asistencia` en el slice 1. Mismo valor: el
# criterio de negocio no cambió, solo el CAMINO por el que se corrige.
#
# Issue #663: además de `AsistenciaServicio.corregir_asistencia` (que
# rechaza la corrección pasada la ventana), `AsistenciaResponseDTO` también
# lee este número para computar `correctable` -- el frontend lo necesita
# para decidir si mostrar el botón "Corregir" o el motivo de por qué no,
# ANTES de que el admin intente corregir y reciba un 400. Si el número
# viviera solo en `servicios_negocio.asistencia_servicio`, la respuesta
# hubiera sido mirrorearlo en TypeScript -- exactamente la clase de
# duplicación entre dos lenguajes que ya se repitió sin querer en
# `frontend/src/app/trainer/attendance/attendance-utils.ts`
# (`CORRECTION_WINDOW_DIAS`) y en
# `frontend/src/app/trainer/attendance/history/page.tsx`
# (`LIMITE_CORRECCION_DIAS`). Un solo entero, importado por ambas capas
# backend, es la fuente de verdad; el DTO lo expone y el frontend solo lee
# el campo.
LIMITE_CORRECCION_ASISTENCIA_DIAS = 30
