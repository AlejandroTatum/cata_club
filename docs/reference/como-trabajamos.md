# Cómo trabajamos — Cata Club

Este documento no es una lista de buenas intenciones. Es el método que
sostuvo la sesión que cerró los doce ítems y abrió los ocho de
`docs/archive/plans/pendientes.md` — escrito para alguien que retoma el proyecto sin haber
estado. Cada criterio es accionable, no aspiracional: si no podés decidir con
él en la mano, no está bien escrito.

> Nota (2026-08-13): las listas de pendientes citadas abajo quedaron
> históricas. La única lista viva de preparación para producción es
> [`../operations/production-readiness.md`](../operations/production-readiness.md).

## Los doce criterios

1. **Verificar antes de afirmar.** Ninguna afirmación técnica sale sin un
   comando que la sostenga. Si la afirmación es «el enum sigue vivo en dos
   lugares», el comando muestra las dos líneas, no la promete.

2. **No tomar a los subagentes por su palabra.** Un subagente que dice «listo»
   describe su intención, no necesariamente lo que hizo. Verificar cuesta dos
   comandos — leer el diff, correr el test — y esos dos comandos son más
   baratos que descubrir el problema en producción.

3. **CI verde es la barra de entrega, no la suite local.** El error más caro
   de la sesión fue dar por entregado un PR con la suite local en verde y CI
   en rojo; `main` quedó roto durante tres merges seguidos. Un recibo de RDD
   certifica que se revisó el candidato — **no** que el pipeline vaya a pasar.
   Y `vitest` no cubre Playwright: verde en uno no dice nada del otro.

4. **Buscar la clase, no la instancia.** Un bug que aparece una vez rara vez
   aparece una sola vez. Si un `afterEach` mal filtrado rompió un test, la
   pregunta siguiente es qué otro `afterEach` tiene el mismo defecto — no si
   ese test en particular ya quedó verde.

5. **Parar cuando un caso del dominio contradice una decisión ya tomada.**
   Pasó tres veces en esta sesión y las tres veces parar fue lo correcto.
   Ejemplo real: «la categoría del alumno» se trataba como un valor único
   hasta que la QA mostró alumnos en tres categorías a la vez y otros en
   ninguna. Seguir programando sobre la premisa rota es más caro que
   pararse a corregirla.

6. **Cortar PRs por presupuesto de corrección, no por líneas.** RDD da UNA
   corrección por candidato sin importar el tamaño del diff — cortar por
   cantidad de líneas no compra nada ahí. El criterio que manda es otro:
   **cada PR intermedio tiene que dejar el sistema funcionando.** Un PR que
   dependa del siguiente para no romper nada no es un PR intermedio válido.

7. **Fusionar rediseño y migración de tokens.** Si una pantalla se está
   tocando para aplicar el sistema visual nuevo, esa misma pasada elimina sus
   tokens `cata-*`. Dos pasadas separadas —una de diseño, otra de limpieza—
   duplican el costo de revisión sobre el mismo archivo.

8. **Un escritor por cambio, cada agente en su worktree.** Dos agentes
   escribiendo el mismo archivo desde ramas distintas no es paralelismo, es
   una fusión diferida. El aislamiento por worktree es lo que hace seguro
   correr agentes en simultáneo sobre el mismo repo.

9. **Preguntar cuando la respuesta cambia el trabajo; decidir cuando no.** No
   toda ambigüedad merece una pregunta. Si cualquiera de las dos respuestas
   posibles lleva al mismo código, decidí y seguí. Si cambian el diseño,
   preguntá una vez y esperá.

10. **Cuando una decisión nueva choca con una regla vieja documentada, casi
    nunca hay que elegir una** — normalmente falta distinguir los ámbitos.
    Caso real: «el número siempre es `ink`» (regla de color de texto) contra
    «los conteos llevan color semántico» (regla de estado). Las dos eran
    correctas en su ámbito: la resolución fue no colorear un número para
    juzgarlo (bien/mal), sino para identificarlo (cuál es cuál). El conflicto
    aparente era una pregunta mal encuadrada, no una contradicción real.

11. **Gate → acción, nunca al revés.** Un `pre-push` corrido después del push
    no se puede reparar: el rango que certifica ya no existe. El orden
    siempre es validar el gate y recién después ejecutar la acción que
    autoriza — commitear, pushear, abrir el PR.

12. **Nada se cierra en un documento; se cierra en un test que se pone rojo
    cuando el defecto vuelve.** Una fila en una tabla de «Cerrados» es una
    afirmación, no una garantía. La garantía es el candado: el test que, si
    alguien reintroduce el defecto, falla solo, sin que nadie tenga que
    acordarse de mirar la fila.

## Trampas operativas que costaron tiempo

Errores concretos de esta sesión, para no repetirlos:

- **Los lentes de revisión se lanzan en primer plano, con el bloque de
  contexto completo de una sola vez.** Lanzarlos en segundo plano o con el
  contexto partido en llamadas sucesivas produce revisiones incompletas que
  parecen completas.
- **Un `--lineage` inventado rompe en silencio.** Si el identificador de
  lineage no vino de un comando real, no lo escribas a mano — el sistema no
  siempre avisa que es inválido, y el receipt resultante certifica algo que
  no corrió.
- **El squash-merge rompe `git branch -d` y miente `merge-base
  --is-ancestor`.** Después de un squash-merge, la rama local no aparece
  como ancestro de `main` aunque su contenido ya esté ahí — `git` compara
  commits, no contenido. Verificá por contenido (`git diff main..rama`
  vacío) antes de asumir que una rama quedó huérfana o que hace falta
  rebasearla.
- **Una rama apilada sobre un PR que mergea por squash arrastra un ancestro
  fantasma.** Si el PR de abajo mergea por squash antes de que la rama de
  arriba se actualice, la rama de arriba queda con un ancestro que ya no
  existe en `main`. Hace falta `rebase --onto` sobre el nuevo `main` y volver
  a correr la revisión — no alcanza con un merge normal.
- **Docker deja archivos con dueño `root`/`nobody` en el worktree.** Si algún
  paso corrió un contenedor que escribió en el árbol de trabajo, esperá
  encontrar archivos que ni el usuario ni el agente pueden borrar sin
  privilegios elevados; identificalo temprano, no cuando el `git status`
  ya no tiene sentido.

## Documento hermano

Los defectos y la deuda técnica que dejó esa sesión están en el histórico
[`docs/archive/plans/pendientes.md`](../archive/plans/pendientes.md), no acá — este documento es el
método, no un pendiente. Para el estado vigente de preparación para
producción, ver [`../operations/production-readiness.md`](../operations/production-readiness.md).
