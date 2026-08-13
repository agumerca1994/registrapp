# Importador masivo de resúmenes de tarjeta (in-app)

## Contexto

Hoy la carga de gastos de tarjeta en RegistrApp es 100% manual, ítem por ítem, desde `/tarjetas/[cardId]/[statementId]`. La única forma de cargar volumen es una serie de scripts CLI (`backend/scripts/import_*.py`, uno por banco) que corren manualmente contra producción vía `docker exec` — pensados para una carga histórica puntual, no para uso recurrente del usuario final.

El usuario quiere una feature real dentro de la app: arrastrar un PDF de resumen, ver una tabla editable con lo extraído (fecha, descripción, categoría sugerida, cuotas, total), corregir/eliminar filas, y confirmar la carga — reusando la misma lógica de propagación de cuotas, resolución de categoría USD y detección de duplicados que ya existen (en el endpoint vivo y en los scripts offline, hoy duplicadas entre sí). Pidió explícitamente evaluar si esto conviene como feature in-app o como herramienta externa, e investigar qué patrones usa la industria para importaciones similares.

**Decisiones ya tomadas con el usuario** (no reabrir):
1. **In-app**, no herramienta externa — la propagación de cuotas y la resolución de categoría USD viven en lógica de servidor acoplada a los modelos; no hay endpoint bulk público, así que una herramienta externa perdería atomicidad o tendría que reimplementar reglas de negocio.
2. **"Asincrónico" = request no bloqueante con spinner**, no job en background — mismo patrón síncrono que ya usa `/income/import/preview` + `/income/import/run`. No hay Celery/Redis en el repo; introducir un job real sería infraestructura nueva no justificada para parsear un PDF (rápido con `pdfplumber`).
3. **Solo los 5 parsers determinísticos por banco existentes** (BBVA, BBVA Mastercard, Naranja X, Banco Nación, Banco Nación Mastercard) — sin fallback con LLM en esta iteración. La investigación de mercado (Unstract, artículos de 2026 sobre extracción de PDFs financieros con LLM) confirma que los LLMs generalizan mejor pero no son reproducibles para datos financieros — los parsers determinísticos siguen siendo la norma cuando la reproducibilidad importa, lo cual valida el enfoque ya usado en RegistrApp.
4. **Adoptar Radix ahora** (`@radix-ui/react-dialog`, `-select`, `-toast` — instalados en `package.json` pero sin un solo import real en todo el código hoy) para esta pantalla nueva, específicamente para el picker de categoría por fila y el feedback final de importación. Es la primera pantalla de la app en usar estas dependencias; el resto de los modales existentes (hand-rolled `fixed inset-0`) no se retocan.
5. **Refactor completo de los parsers**: mover los 5 parsers y los helpers de negocio (propagación de cuotas, categoría USD, duplicados) desde `backend/scripts/import_*.py` a un módulo compartido `app/services/`, para que tanto los scripts offline como el nuevo endpoint importen de ahí en vez de mantener 2-3 copias de la misma lógica.
6. **Todo-o-nada al confirmar**: si cualquier fila falla al importar, se hace rollback del resumen completo (mismo comportamiento que ya tienen los scripts offline) — más simple de razonar con la propagación de cuotas en cascada que un modelo de "saltear la fila con error y comitear el resto" como hace `/income/import/run`.
7. **Default de "es el resumen más reciente"** (controla si se propagan cuotas futuras): combinar dos señales — (a) comparar year/month contra el resumen más nuevo que ya exista en DB para esa tarjeta, y (b) chequear si year/month es el mes actual o el mes anterior al de hoy. Si ambas señales coinciden en que es el más reciente, el checkbox arranca tildado; si no coinciden o el mes es claramente viejo, arranca destildado. El checkbox queda siempre visible y editable, con un texto explicando qué controla, para que el usuario lo corrija si la heurística se equivoca.

## Investigación: cómo lo resuelven otras plataformas

- **Monarch Money / YNAB**: auto-detección de columnas por keywords + tabla de preview antes de confirmar. Duplicados por fecha+monto (Monarch) o ID único de transacción cuando el formato lo trae (YNAB/OFX).
- **Firefly III** (open source): motor de reglas usuario-definidas (trigger→acción) sobre transacciones importadas — inspiró la idea de "categoría sugerida" con fallback a elección manual.
- **Actual Budget** (open source): import 100% manual (subir CSV/QFX), sin auto-sync — valida que un flujo simple upload→preview→confirm es aceptable incluso en herramientas maduras.
- **ReceiptsAI / DocuClipper / Bankstatemently**: drag-and-drop de PDF → extracción → categorización automática → detección de recurrentes/cuotas — confirma que ir directo a PDF (sin CSV intermedio) es un patrón de producto ya validado en el mercado.
- **LLM vs parser determinístico**: consenso reciente de que los LLM generalizan mejor a formatos nuevos pero no son reproducibles para datos financieros; parsers determinísticos por formato siguen siendo la opción preferida cuando la reproducibilidad importa (valida la decisión #3 de arriba).

## Enfoque recomendado

### Backend

**Nuevo módulo compartido — `backend/app/services/credit_card_import.py`** (el paquete `services/` existe hoy pero está vacío, es el lugar natural):
- Helpers de negocio promovidos (no copiados) desde las versiones casi-duplicadas que hoy viven separadas en `routers/credit_cards.py` y en cada script: `get_or_create_usd_category`, `create_expense_entry`, `find_or_create_statement`, `next_month_date`, `find_amount_duplicates`, más una función nueva `import_item(...)` que generaliza el `_import_item` de los scripts (soporta `installment_number > 1` para resúmenes donde la cuota raíz ya fue importada antes — ver "Reconciliación de cuotas" abajo).
- `backend/app/routers/credit_cards.py` y los 5 scripts en `backend/scripts/import_*.py` pasan a importar estos helpers desde acá en vez de mantener su propia copia.

**Parsers relocados — `backend/app/services/statement_parsers/`**: un módulo por banco (`bbva.py`, `bbva_mastercard.py`, `naranjax.py`, `banco_nacion.py`, `banco_nacion_mastercard.py`), cada uno expone `detect(lines) -> bool` (fingerprint del banco a partir del texto de la página 1) y `parse(pdf) -> dict` (mismo shape de JSON que ya producen hoy los scripts). Un registro central `detect_and_parse(pdf_bytes)` prueba cada `detect()` en orden y lanza un error claro si ninguno matchea. Los `backend/scripts/import_*.py` se recortan para importar su parser desde acá en vez de mantenerlo local.

**Dos endpoints nuevos en `credit_cards.router`** (mismo prefijo `/credit-cards`, no hace falta nuevo router):

```
POST /credit-cards/import/preview
  multipart/form-data: file (PDF), card_id opcional
  → StatementImportPreviewOut: { source_filename, statements: [...], categories: [...], excluded_count }
```
Cada fila extraída (`ImportItemPreview`) trae `row_id` (uuid generado server-side, necesario porque el frontend edita/borra filas antes de confirmar), `suggested_category_id` + `suggested_category_confidence`, `is_possible_duplicate` + `duplicate_of_item_id`. Cada resumen (`StatementMetaPreview`) trae `suggested_card_id` y `suggested_is_latest_statement` (la heurística combinada de la decisión #7).

```
POST /credit-cards/import/run
  application/json: StatementImportRunIn (las filas EDITADAS por el usuario, agrupadas por resumen)
  → StatementImportRunOut: { statements: [...], created, skipped, errors }  (o 422 con el mismo shape si falló)
```
**`run` no vuelve a parsear el PDF** — recibe y confía en el JSON editado por el usuario (mismo nivel de confianza que ya tiene hoy `POST /credit-cards/statements/{id}/items`, que también acepta datos completamente provistos por el cliente). Las filas borradas por el usuario simplemente no viajan en el array — no hace falta un flag `skip`.

**Duplicados contra un resumen que puede no existir todavía**: si ya existe un `CreditCardStatement` para `(card_id, year, month)`, se compara por monto exacto contra sus items (misma heurística ciega que ya usan los scripts). Si el resumen es nuevo, se amplía el chequeo para cuotas: buscar si ya existe una cadena de cuotas con la misma descripción+monto+cantidad de cuotas en la tarjeta, para no duplicar una compra en cuotas que ya se importó antes y cuya próxima cuota recién ahora "colisiona" dos meses después.

**Reconciliación de cuotas** (el punto más delicado de todo el feature): un resumen puede mostrar "cuota 4/12" de una compra cuyas cuotas 1-3 ya se cargaron en resúmenes anteriores. `import_item` debe distinguir 3 casos según `installment_number` y el checkbox "es el más reciente":
- `installment_number == 1`: igual que `create_item` hoy — raíz + propaga cuotas 2..N.
- `installment_number > 1` y "es el más reciente" tildado: se crea como registro standalone (sin `installment_group_id`, porque la raíz real ya se importó en un resumen anterior fuera de este import) pero propaga las cuotas restantes hacia adelante — mismo camino que ya usa `finalize_statement` para raíces sin hijos.
- `installment_number > 1` y "es el más reciente" destildado (resumen histórico): se carga como registro histórico plano, sin propagar nada — mismo comportamiento que `_import_item(propagate_future=False)` en los scripts hoy.

**Categoría sugerida** (lógica nueva, sin precedente en el código): sobre las últimas ~500 descripciones de `CreditCardItem`/`ExpenseEntry` (`payment_method="tarjeta_credito"`) del tenant, normalizar texto (minúsculas, sin tildes, sin ruido de cuotas) y calcular similitud por solapamiento de tokens (Jaccard) contra la descripción nueva; si supera un umbral, sugiere la categoría de la mejor coincidencia histórica con su score como `confidence`. Sin matches, `suggested_category_id=null` y el usuario elige a mano. Es una heurística simple explícita — no ML, corre en el mismo request de `preview`.

### Frontend

- **Nueva ruta**: `frontend/app/(app)/tarjetas/importar/page.tsx`, con botón de entrada ("Importar resumen PDF") en `frontend/app/(app)/tarjetas/page.tsx`.
- **Gate desktop-only**: mismo patrón que `ProductTour`'s `requireDesktop` (`window.matchMedia("(min-width: 768px)")` en un `useEffect`), pero como gate de página completa: si no cumple el breakpoint, muestra un mensaje explícito ("Esta función solo está disponible en pantallas de escritorio") en vez de la pantalla — no un no-op silencioso.
- **Drag-and-drop real** (no existe en ningún lado de la app hoy — el "dropzone" de ingresos es en realidad solo click-to-browse): handlers nativos `onDragOver`/`onDrop`/`onDragLeave` sobre un `<div>`, con `<input type="file">` oculto como fallback de click.
- **Tabla editable** (`frontend/components/StatementImportTable.tsx`): columnas Fecha (input date) | Descripción (input text) | Categoría (Radix `Select`, con ítem "+ Nueva categoría" al final que abre un Radix `Dialog` — generaliza el patrón `NewCategoryModal` + `handleCreateCategory` que ya existe en `tarjetas/[cardId]/[statementId]/page.tsx`) | Cuotas (par de inputs N/M editables solo si `item_type=installment`) | Total (editable, `parseAmount`/`formatARS`/`formatUSD` de `lib/utils.ts`, representa el monto por cuota — no el total de la compra, aclarar en el copy). Filas con `is_possible_duplicate=true` muestran un badge de advertencia pero quedan incluidas por defecto (el usuario decide borrarlas o no). Botón de borrar por fila (splice del estado local, la fila simplemente no viaja en el request de `run`).
- **Resultado**: Radix `Toast` con el resumen (`{created} cargados, {skipped} duplicados, {errors} errores`); en caso de error 422, la tabla se mantiene poblada tal cual la dejó el usuario, con las filas fallidas resaltadas inline para corregir y reintentar sin perder el resto de las ediciones.
- **Cambiar de tarjeta re-dispara preview**: si el usuario cambia la tarjeta sugerida para un resumen, se vuelve a llamar `/import/preview` con el mismo archivo (retenido en estado) para recalcular duplicados correctamente contra la tarjeta correcta.

## Archivos críticos

**Backend — nuevos:**
- `backend/app/services/credit_card_import.py` — helpers compartidos + `import_item`
- `backend/app/services/statement_parsers/__init__.py` + un módulo por banco (5 archivos)
- `backend/app/schemas/credit_card_import.py` — los Pydantic models de preview/run

**Backend — modificados:**
- `backend/app/routers/credit_cards.py` — agrega `POST /import/preview` y `POST /import/run`; `create_item`/`finalize_statement` pasan a llamar los helpers compartidos en vez de su copia local
- `backend/scripts/import_bbva_statements.py` + los otros 4 scripts hermanos — se recortan para importar parser + helpers desde `app.services...`

**Frontend — nuevos:**
- `frontend/app/(app)/tarjetas/importar/page.tsx`
- `frontend/components/StatementDropZone.tsx`
- `frontend/components/StatementImportTable.tsx`
- `frontend/components/StatementCategoryCell.tsx` (Radix Select + Dialog)

**Frontend — modificados:**
- `frontend/app/(app)/tarjetas/page.tsx` — botón de entrada a la nueva ruta

**Referencias a seguir de cerca durante la implementación** (no se modifican, son el patrón a espejar):
- `backend/app/routers/income.py` (`/income/import/preview` + `/income/import/run`) — forma general del contrato preview→run
- `backend/scripts/import_bbva_statements.py` — parser de referencia y heurística de duplicados a generalizar
- `frontend/app/(app)/tarjetas/[cardId]/[statementId]/page.tsx` — patrón de categoría con creación inline a llevar a Radix

## Riesgos a tener en cuenta durante la implementación

1. **Reconciliación de cuotas a mitad de plan** (`installment_number > 1`) es la lógica de negocio más delicada de todo el feature — probar a mano con secuencias reales de resúmenes de varios meses por banco antes de dar por cerrado.
2. **Detección de formato por banco** es por fingerprint de texto — si un banco cambia su plantilla, `detect()` empieza a fallar silenciosamente para ese banco (ya pasó antes: BBVA tiene un parser separado para su producto Mastercard). Vale la pena loguear qué `detect()` falló (vía `AppLog` existente) para poder diagnosticarlo.
3. **Heurística de categoría sugerida** es código nuevo sin precedente — esperar que funcione bien para comercios repetidos (suscripciones, supermercados habituales) y mal para comercios nuevos (donde el usuario simplemente elige a mano).
4. **Radix como primer consumidor real** en el frontend — con cero código existente ejercitando estos paquetes, puede aparecer fricción de integración (hidratación SSR, z-index contra los modales hand-rolled existentes) recién al implementar, no antes.

## Verificación

- Backend: probar `POST /credit-cards/import/preview` con PDFs reales de cada uno de los 5 bancos/productos ya soportados (hay muestras usadas para construir los scripts offline) y confirmar que el JSON de preview coincide en contenido con lo que hoy produce `extract` en cada script.
- Probar el flujo completo end-to-end en `docker compose up`: arrastrar un PDF real, editar categorías (incluyendo crear una nueva inline), borrar una fila, confirmar, y verificar en `/tarjetas/[cardId]/[statementId]` que los ítems y las cuotas futuras se crearon correctamente — comparar contra lo que produciría el script offline equivalente para el mismo PDF.
- Probar específicamente un caso de "cuota N>1 en el resumen más reciente" y confirmar que no duplica ni salta cuotas ya existentes de una importación anterior.
- Probar el gate desktop-only reduciendo el viewport del navegador por debajo de 768px.
- Confirmar que los 5 scripts en `backend/scripts/` siguen funcionando igual que antes tras el refactor (correr `extract`/`import --dry-run` contra un PDF de muestra de cada banco).