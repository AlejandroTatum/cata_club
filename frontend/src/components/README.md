# `src/components/` — componentes de interfaz

Componentes de React compartidos entre páginas.

Este archivo **no lista los componentes**. La versión anterior lo hacía y
nombraba uno solo —`Header`— cuando existían cuarenta. Una tabla que duplica lo
que el árbol ya dice envejece con el primer componente que se agrega:

```bash
fd -e tsx . src/components -E '__tests__'
```

## Cómo está dividido

| Carpeta | Qué vive ahí |
|---|---|
| `ui/` | Las primitivas del sistema visual: botón, tarjeta, campo, insignia, estado vacío. Es la mitad del directorio y lo que `DESIGN.md` gobierna directamente. |
| `shell/` | El armazón de la aplicación: el riel de navegación, la barra superior, el andamiaje que envuelve a toda pantalla autenticada. |
| `auth/` | Lo que envuelve a las pantallas de credenciales. |
| `attendance/`, `chatbot/` | Piezas de un solo dominio, agrupadas porque no se usan fuera de él. |
| raíz | Lo transversal que no entra en ninguna de las anteriores. |

**Antes de escribir un componente nuevo, mirá `ui/`.** Varias piezas del
sistema se escribieron, se testearon y no tuvieron un solo consumidor durante
meses: la franja semanal y la celda de identidad estuvieron así hasta que el
rediseño las encontró. Duplicar una primitiva que ya existe es más fácil que
encontrarla.

## Convenciones

- Un componente por archivo, con el nombre del archivo.
- `"use client"` solo cuando hay estado, efectos o manejadores de eventos. Por
  defecto son componentes de servidor.
- Interfaces de TypeScript declaradas arriba del archivo.
- Lo visual sale de [`DESIGN.md`](../../../DESIGN.md) y de los tokens de
  `tailwind.config.ts`. Un valor escrito a mano donde hay un escalón declarado
  lo bloquea `lib/__tests__/arbitrary-style-values.test.ts`.

### Sobre la forma de exportar

La versión anterior declaraba que los componentes reutilizables usan
`export function` nombrado y los de página `export default`. **La segunda mitad
es cierta y la primera no**: treinta y tres de los cuarenta componentes usan
`export default`, y solo siete el nombrado. No se documenta acá como regla
porque no lo es — seguí lo que hace el archivo que estés tocando.
