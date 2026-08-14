# `src/controllers/` — reservado, y vacío

> **Estado: VACÍO.** Este directorio no contiene un solo controlador. Solo este
> archivo. Verificable con `fd -t f . src/controllers`.

Está reservado para orquestación a nivel de página: lo que no es ni una llamada
de datos ni un componente, y que empieza a estorbar dentro de un `page.tsx`
cuando crece.

## A dónde va cada cosa hoy

| Preocupación | Dónde vive |
|---|---|
| Llamadas al backend, obtención de datos | `src/services/` |
| Acceso al backend desde el servidor | `src/lib/server/` |
| Estado de interfaz, renderizado | `src/components/` y las páginas de `src/app/` |
| Utilidades puras y reglas compartidas | `src/lib/` |
| Orquestación de una página, formateadores, transformadores | acá, cuando exista |

## Por qué sigue vacío

Porque `src/lib/` absorbió lo que este directorio iba a recibir, y esa decisión
funcionó: las reglas compartidas del producto —el registro de destinos, la
rampa de tinta, la escala de iconos— viven ahí con sus candados de test al
lado.

**Si vas a crear el primer controlador, la pregunta previa es si no pertenece a
`src/lib/`.** Un directorio reservado durante meses suele estarlo porque la
necesidad que lo justificaba se resolvió en otro lado.

Convención si se implementa: el nombre del archivo sigue al de la página que
sirve, por ejemplo `membersController.ts` para `/members`.

---

*Nota: la versión anterior de este archivo traía un ejemplo con
`productsController.ts`, `fetchProducts()` y un filtro por `p.stock > 0` —
plantilla de comercio electrónico, de un dominio que este sistema no tiene. Se
retiró: un ejemplo que no puede existir en el proyecto no enseña dónde poner
las cosas, enseña a desconfiar del documento.*
