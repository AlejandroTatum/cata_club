# Candado de valores arbitrarios de estilo

El test `frontend/src/lib/__tests__/arbitrary-style-values.test.ts` falla cuando entra al
código un valor de estilo arbitrario que no estaba en el inventario del día que se instaló.
No limpia nada: impide que la deuda crezca mientras los issues #29–#32 la bajan.

Corre dentro de `pnpm test`, así que ya es un gate del job Frontend del CI.

## Camino rápido

1. El CI falla con `text-[19px] is not an allowed typography value`.
2. El mensaje nombra el archivo, el valor y el token más cercano: usar ese token.
3. `pnpm test` en `frontend/` para confirmar.

Si el valor es de verdad inevitable, **no se agrega a la lista blanca**: se le da un nombre
en `tailwind.config.ts` y deja de ser arbitrario.

## Los siete ejes

| Eje | Patrón | Reemplazo |
|---|---|---|
| Tipografía | `text-[13px]` | escala `text-*` |
| Interlineado | `leading-[1.45]` | escala `leading-*` |
| Tracking | `tracking-[0.13em]` | escala `tracking-*` |
| Peso | `font-medium` | `font-semibold` · `font-bold` · `font-extrabold` |
| Iconos | `size={21}` en un icono de `lucide-react` | escala `ICON` de `lib/icon-size.ts` |
| Sombras | `shadow-[0_4px_24px_…]` | `shadow-soft` · `shadow-card` · `shadow-elevated` |
| Breakpoints | `min-[980px]` | prefijo con nombre (`sm:` … `2xl:`) |

Los colores arbitrarios (`text-[#B9B9C1]`) quedan fuera a propósito: la paleta la vigila
`color-contrast.test.ts`, y juntar las dos reglas en un solo candado complica achicar ambas.

**El peso es el eje distinto**, y conviene decirlo antes de leer el resto: no se escribe entre
corchetes. Los nueve pesos de Tailwind son clases de fábrica, así que la deriva de este eje nunca
produce un valor arbitrario y los otros seis ejes no la veían — por eso la escala de pesos fue la
única parte del sistema tipográfico que se dispersó sin que el candado dijera nada. Su entrada en
la lista blanca tampoco es deuda que se achica hasta desaparecer: es el conjunto cerrado de pesos
permitidos, y está pensada para quedarse con la longitud que tiene.

**El de iconos terminó igual, por el mismo motivo.** Al cerrar #30 la lista quedó vacía, y una
lista vacía habría bastado para rechazar `size={16}` — pero no `size={iconSize}`, y catorce
tamaños es precisamente en lo que crece uno de esos nombres. Así que la regla se invirtió: en un
archivo que importe `lucide-react`, todo `size={…}` falla salvo una expresión hecha con escalones
de `ICON` que no contenga ningún dígito. Es el único eje que captura una expresión en vez de un
valor, y ya no consulta la lista blanca. Detalle completo en `docs/ux/escala-iconos.md`.

## Cómo se achica la lista blanca

La lista vive en `frontend/src/lib/__tests__/arbitrary-style-values.allowlist.ts`, agrupada
por eje, un valor por línea. Achicarla es el trabajo de cada issue de migración:

1. **Elegir un valor**, no un archivo. `text-[12.5px]` en sus 70 usos es un PR coherente;
   "el archivo X" mezcla seis decisiones distintas.
2. **Migrar todos los usos** al token que lo reemplaza.
3. **Borrar esa línea** de la lista blanca.
4. **`pnpm test`.** Quedan dos resultados posibles, ambos accionables:
   - *"is not an allowed … value"* → falta migrar un uso, y el mensaje dice cuál.
   - *"no longer used, delete this line"* → sobra una entrada; borrarla.

El paso 3 no es opcional. El test verifica en las dos direcciones —que no entren valores
nuevos y que no queden entradas muertas— justamente para que la lista no se convierta en un
permiso permanente que nadie recuerda por qué está.

**Nunca se agregan entradas**, salvo en el eje de peso, que por lo dicho arriba no es una
lista de deuda. Una entrada nueva en cualquiera de los otros seis es exactamente lo que el
candado existe para impedir. El eje de iconos ya no admite ninguna: no tiene lista.

## Inventario congelado (2026-08-01)

| Eje | Valores distintos |
|---|---|
| Tipografía | 24 |
| Interlineado | 9 |
| Tracking | 14 |
| Iconos | 14 → **0** |
| Sombras | 10 |
| Breakpoints | 1 |
| **Total** | **72 → 58** |

Veinticuatro tamaños de texto donde la escala `text-*` tiene diez, y catorce tamaños de
icono, eran la medida del problema que #29–#32 resuelven. Los primeros cuatro ejes ya están
en cero: quedan las sombras y el breakpoint del shell.

El eje de peso no figura en este inventario y nunca va a figurar: se sumó al cerrar #29, no
congela deuda, y el mismo día en que se sumó los tres primeros ejes ya estaban en cero.

## Detalles de implementación

| Tema | Decisión |
|---|---|
| Recorrido | `node:fs`, igual que `focus-ring-usage.test.ts` y `ui-vocabulary.test.ts`. Sin dependencias nuevas, sin subproceso, sin suponer que `rg` está en la imagen de CI. |
| Alcance | `frontend/src/**` en `.ts`, `.tsx` y `.css`, saltando los directorios `__tests__`. |
| Comentarios | Se eliminan antes de escanear: `tailwind.config.ts` y el propio test citan valores prohibidos para explicarlos. |
| Granularidad | Por valor, no por archivo. La regla es "no entran valores nuevos al vocabulario"; una lista por archivo tendría cientos de líneas y rompería con cada movimiento de código. |
| Iconos | Solo se revisa `size={…}` en archivos que importan `lucide-react`, y así la regla no vigila cualquier componente que acepte esa prop. Desde #30 captura la expresión completa, no el número: la exención es nombrar un escalón de `ICON` sin escribir ningún dígito. |
| Sombras del foco | Los anillos `#131316` de la lista los exige `focus-ring-usage.test.ts`. Retirarlos significa mover ese par al tema, no borrarlo. |

## Qué NO reemplaza

El hook de diseño que ya está instalado en el repo. El hook revisa la intención de un cambio
mientras se escribe; el candado cuenta valores en CI. Se complementan.
