---
name: tood-rediseno
description: Pasa una pantalla de tood al diseño nuevo, el de Inicio y Movimientos (papel, vidrio y violeta). Usalo para "rediseñá tal pantalla", "pasá este modal al estilo nuevo" o cuando una pantalla o formulario se vea distinto del resto. Trabaja en el código real, lo revisa a ojo en un celular emulado y no hace commit ni deploy.
---

Sos quien lleva las pantallas de tood al diseño que el usuario aprobó en Inicio y Movimientos. **Cada regla de acá salió de una corrección suya**: no las reinterpretes por gusto propio. Rediseñar es cambiar cómo se ve y cómo se recorre. **Nunca le saques una función a una pantalla.**

## Antes de tocar nada
Mirá lo aprobado, en este orden, y copiá sus decisiones:
1. `frontend/components/home/HouseholdHome.tsx`: el bloque violeta, las fechas en itálica, los accesos.
2. `frontend/app/(app)/(movimientos)/` y `frontend/components/movimientos/`: tarjeta compacta, desglose, lista, ficha y formulario.
3. `frontend/components/layout/AddSheet.tsx` y `MoreSheet` en `Sidebar.tsx`: las hojas de vidrio.

Después capturá la pantalla como está (ver "Cómo revisar") y leé en `CLAUDE.md` lo que dice de esa pantalla. **`CLAUDE.md` manda en reglas de negocio** (cuentas, permisos, por qué algo se muestra). **Este archivo manda en lo visual**: donde `CLAUDE.md` todavía habla de sombra dura, borde grueso o del hero anterior, ya no aplica.

## Lo que el usuario pidió, y por qué
Su punto de partida: la app se sentía "plana y opaca", con "demasiada información por todo lado", y la tabla "como antigua, no coincide con el formato general". Lo que corrigió en el camino:

- **Lo que importa se ve sin bajar.** Si la lista o el detalle quedan abajo de todo, la pantalla está mal. Una sección no puede crecer con los datos: "mientras más categorías existan más se extiende" fue una queja directa. Fila que se desliza, o resumen más "Ver detalle".
- **Las cuentas van detrás de "Ver detalle".** Arriba, las cifras.
- **Nada de datos en cero a la vista.** "Compré U$D 0,00" no le dice nada a nadie: si es cero, no va.
- **Ninguna fila repite lo que ya está en pantalla.** Título y etiqueta iguales ("Sueldo / Sueldo") no se muestran dos veces.
- **Ficha y edición tienen que parecer la misma app** que la pantalla de la que salen. Ahí es donde más se nota lo viejo.

## Sistema visual

**Tokens.** Ya están en `globals.css` y `tailwind.config.ts`. Usalos, no inventes colores:
- Fondo papel (`bg-background`), tarjeta (`bg-card`), bordes finos (`border-border`), tinta (`bg-ink` / `text-foreground`).
- Violeta de marca `primary` (`#5B4FE9`) para la marca y los datos. Sobre fondo claro, el texto violeta es `#3B2FB3`, por contraste.
- Bloque de color: `bg-[linear-gradient(165deg,#4A3FC4_0%,#352A9E_100%)]`, sólo arriba de la pantalla principal de una sección, y sólo si esa pantalla tiene una cifra que lo justifique.
- Lila `bg-accent` con borde `#CFC9E4`: lo pendiente, lo activo, lo que espera algo.
- Ámbar sólo para el puntito de pendiente. Rojo sólo para error y borrar. Verde (`emerald-800`) sólo para plata que entra.

**Tipografía.**
- Urbanist (`font-display`, es la de todo): títulos livianos, `font-medium` y `tracking-[-0.03em]`. Nada de `font-bold` en títulos.
- Montos con `tabular-nums`, que usa Figtree: Urbanist no tiene cifras de ancho fijo. Todo monto en una columna lleva esa clase.
- Fechas de una lista: `font-fecha italic` violeta, con el mes en `font-marca` chico. Es el gesto propio de la app.
- `font-marca` (DM Mono) sólo para marcas chicas ("mié 4 nov", "2 para resolver").
- **Sin etiquetas en mayúsculas con espaciado.** Sin rayas largas (—) en ningún texto.

**Componentes que ya existen. Se reusan, no se copian:**
- `components/movimientos/Ledger.tsx`: `LedgerRow`, `LedgerTotal`, `SelectionBar`, `ledgerAmount`. Toda lista de plata con fecha.
- `components/movimientos/EntrySheet.tsx`: `EntrySheet`, `SheetRow`, `SheetActions`, `SheetLink`. Lo que se abre al tocar una fila.
- `components/movimientos/FormSheet.tsx`: `FormSheet`, `FormSheetActions`, `AmountField`, `FORM_SHEET_FORM`, `FORM_SHEET_BODY`. Todo formulario.
- `components/movimientos/BreakdownStrip.tsx`: un desglose con altura fija.
- `components/ui/`: `Card`, `Button`, `Chip`, `SegmentedToggle`, `SelectField`, `DateField`, `MonthField`, `FilterBar` y compañía, `MonthPill`, `ScrollRow`.
- `components/NewCategoryModal.tsx`: uno solo. No dupliques modales: si una pantalla tiene su propia copia de algo compartido, reemplazala.

**Listas.** Sobre el papel, sin recuadro, con líneas finas: la forma de `LedgerRow`.
- Sin casilleros permanentes. Seleccionar varios va en el menú ⋮ y prende `SelectionBar`.
- Sin chevrons en cada fila.
- Montos en tinta, no en rojo. Sin ",00" en listas (`ledgerAmount`); los centavos se ven en la ficha.

**Fichas (tocar una fila).** Siempre `EntrySheet`: fecha, monto grande, qué es, y un bloque sólo con lo que agrega algo.
- "Editar" es la acción principal. "Eliminar" es texto rojo discreto y confirma ahí mismo (`SheetActions`), sin `confirm()` del navegador.
- Lo que se maneja en otro lado se dice y lleva hasta ahí (`SheetLink`).

**Formularios.** Siempre `FormSheet`: Cancelar y Guardar quedan a la vista.
- Si hay plata, el monto va primero y grande con `AmountField`.
- Un monto en un campo se muestra como se escribe acá ("4.069.000,00"), nunca crudo ("4069000.00").
- Los amounts se leen siempre con `parseAmount`, nunca con `parseFloat`.

**Vidrio.** Sólo en lo que flota sobre contenido que se mueve: barras, hojas, menús. Una lista o un formulario no se leen sobre algo que se mueve atrás.

**Filtros.** Siempre `components/ui/filters.tsx`, que es la tira aprobada: círculo de búsqueda que se abre en una píldora, `SortChip`, y el círculo de `FilterChip` al final que abre `FilterPanel`. Lo activo va oscuro. No lo restyles en una pantalla.

**Movimiento: toda acción se ve.** El usuario lo pidió así. Nada de bucles, y todo lo apaga el movimiento reducido. Las piezas están en `lib/motion.ts` y `globals.css`:
- **Una lista o un bloque cuyo contenido cambia:** `useListMotion()` en el contenedor directo de las filas. Lo que se agrega entra, lo que se borra se cierra y el resto se corre.
- **"Ver detalle" y todo lo plegable:** `useListMotion()` en el padre de lo que aparece, con el chevron girando (`transition-transform`, `rotate-180`). Sin saltos.
- **Dos o tres opciones excluyentes:** `SegmentedToggle`, cuya tira se desliza. No armes otra.
- **Hojas:** `FormSheet` y `EntrySheet` ya bajan al cerrarse, hasta al guardar. Una hoja propia no Radix usa `useExitGhost()`. Una de Radix lleva `animate-sheet-in` y `animate-fade-in`, que ya se van solas.
- **Guardar o borrar:** `useReaccion()`, la t confirma. Toda pantalla que escribe la usa.
- **Apretar:** los botones ya responden, desde `globals.css`. Una fila que da otra señal lleva `data-no-press`.
- **Cambiar de pantalla:** ya funde, desde `app/(app)/template.tsx`.
- La cifra principal puede contar con `useCountUp`, una sola por pantalla.

## La guía de cada pantalla
Muestra aprobada: la de Inicio (`tourSteps` en `components/home/HouseholdHome.tsx`) y las de `(movimientos)`. El globo, el avance y el recorte los pone `components/ProductTour.tsx`. No lo copies ni lo restyles: sólo escribí pasos.

- **Si tu pantalla tiene guía, se reescribe con ella.** Un paso que apunta a algo que ya no está se pierde en silencio. El `tourId` no cambia: si cambia, a quien ya la vio le vuelve a aparecer. Uno nuevo va en `APP_TOUR_IDS` o `BUSINESS_TOUR_IDS` y en `e2e/auth.setup.ts`.
- **Muestra lo que hay en la pantalla, en el orden en que se mira.** No es un índice de la navegación.
- **Cada paso lleva `title` y `content`.** El título son pocas palabras. El contenido, una o dos frases que dicen para qué sirve, no qué es. De 2 a 6 pasos.
- **En el celular igual que en la compu.** Sin `requireDesktop` y sin `placement` fijo: el globo se ubica solo. Un destino que cambia según la pantalla va con los dos selectores: `"[data-tour='nav-add'], [data-tour='x-add']"`, y `ProductTour` elige el que se ve. El + del celular es `nav-add`.
- **Un paso que depende de los datos se agrega sólo si el dato está** (mirá el `hasPeriods` de Inicio). Una pantalla vacía no lleva guía: no hay nada que mostrar, y queda para cuando lo haya.
- **Lo que un paso diga tiene que ser cierto en el código.** Sin promesas y sin jerga.
- **Probala de verdad:** borrá `tour_seen_<id>` y recorré todos los pasos en celular y compu, mirando que el globo no tape lo que explica. Esa es la única vez que no marcás las guías como vistas.

## Trampas que ya costaron
- **`FormSheet` no es un Dialog de Radix a propósito**: el combo y el calendario se abren en un portal sobre `body`, y un Dialog modal bloquea los toques afuera. `EntrySheet` sí es un Dialog porque no tiene combos.
- **`backdrop-filter` encierra a los `fixed`.** Lo que abra otra ventana fija va como hermano de la hoja, nunca adentro. Pasó con `ParticipantPicker`.
- **Un `fixed` adentro de `space-y-*`** ya no corre el fondo, lo resuelve `globals.css`. No agregues parches.
- **`font-size: 16px !important`** en los inputs evita el zoom de iOS. Para uno más grande, `!text-[..px]`.
- **Toda pantalla con montos llama a `useAmountsHidden()`**, y lo que formatea plata por su cuenta mira `areAmountsHidden()`. Si no, "Ocultar montos" deja números a la vista.
- **Monedas: nunca sumes pesos con dólares.** Las reglas de plata están en `CLAUDE.md` y en los comentarios de cada archivo. No las cambies para que algo se vea mejor. Si una cifra no te cierra, avisá.
- **Los comentarios que explican un porqué se conservan** si la regla sigue vigente. Si tu cambio la vuelve falsa, actualizalos.
- **Un botón sin destino no existe.** Todo control hace algo real. Estados vacío, cargando y error siempre, diciendo qué pasó y qué hacer.
- **Celular primero**: 390 px sin desborde lateral, toques de 44 px como mínimo. La barra flotante tapa los últimos 90 px.
- **Texto:** español rioplatense, sin jerga interna. "Subir resumen" y no "conciliar", en pantalla. Sin promesas que el código no cumpla.

## Los tests
Los E2E buscan por rol y por texto. Antes de cambiar un nombre, buscá en `frontend/e2e/` quién lo usa, y si el cambio es legítimo, actualizá el test en el mismo paso. Después de cambiar algo, corré `npx tsc --noEmit -p .` desde `frontend/`.

## Cómo revisar
**No des por terminado lo que no viste.** Con el Playwright del proyecto (`frontend/node_modules/playwright`), con scripts fuera del repo, en el directorio temporal que te indiquen:
- Celular: `viewport 390×844, deviceScaleFactor 2, isMobile, hasTouch, reducedMotion: "reduce"`. También compu, 1280 de ancho.
- Entrar: en `/login`, `window.__e2e.ready` y después `__e2e.signInWithEmailAndPassword(__e2e.auth, mail, clave)`.
- Marcá las guías como vistas (`localStorage.tour_seen_<id> = "1"`) y cerrá el aviso de compartidos si aparece.
- Recorré lo que tocaste de verdad: abrir, editar, guardar, cancelar, borrar, el estado vacío. Tocar un botón y ver qué pasa, no suponerlo. Datos de prueba sólo en cuentas de demo, inventados, nunca en la cuenta de los E2E.
- Mirá cada captura con el Read y corregí lo que veas antes de seguir.

## Lo que nunca
- No hagas commit, push ni deploy.
- No toques backend ni migraciones salvo que te lo pidan. Si una pantalla necesita un dato que no hay, decilo.
- No toques los componentes compartidos si te dijeron que otro trabajo los usa: pedí el cambio en tu informe.
- No cambies la t ni el logo.

## Al terminar
Informá: qué pantallas quedaron, qué probaste a mano y qué no, qué tests hay que correr, qué función te dio dudas y qué dejaste como estaba, y todo lo raro que hayas encontrado. Lo que no probaste se dice.
