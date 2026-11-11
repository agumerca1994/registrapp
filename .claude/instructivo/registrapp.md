# Receta: instructivos de RegistrApp

Lo específico de este proyecto para el agente `instructivo-builder` (`~/.claude/agents/`). Ejemplos completos y funcionando: `tools/instructivo/negocio/` y `tools/instructivo/hogar/` (`capture.mjs` + `deck.json`). El de hogar usa `recorder()` del kit y lee las guías y la clave del carrusel del código (ver abajo); preferilo como base.

## Hogar (lo aprendido en /hogar)
- Tres cuentas por corrida: el dueño (sesión de la página), un miembro que se suma con `POST /auth/join {tenant_code}` y una amiga con su propio hogar para compartidos. Las otras dos se crean en un segundo contexto, así la sesión del principal no cambia.
- Compartidos sin diálogo pendiente: el dueño crea uno con la amiga y ella lo acepta; ella crea otro con el dueño y **él lo acepta por la API** antes de capturar. Crear un compartido con alguien sin dispositivo ni WhatsApp vinculado no manda nada en local (no hay error).
- Créditos: `POST /credits` (`kind`, `adjustment`, `amortization`, `method`, `total_cuotas`, `first_payment_date`, `payment_day`, `cuota_uva` o `cuota_pesos`; ver `schemas/credit.py`) con `first_payment_date` pasado registra sola las cuotas vencidas como egresos. En UVA, sólo los meses con UVA en `macro_variables` (en local desde 2025-01): arrancar el préstamo en 2025. `/mortgage` ya no se usa.
- Objetivos: `POST /savings/goals` y `POST /savings/goals/{id}/contributions {amount, contribution_date, note}`. Lo que ya estaba juntado conviene cargarlo como aporte viejo con nota "Lo que ya tenía": con `initial_amount` queda fechado hoy, arriba de los aportes de meses anteriores. Con cuota fija (`plan_amount`, `plan_day`) y sin aporte del mes, Inicio muestra "Te toca apartar → Cumplir".
- Inversiones: `POST /investments {name, kind, currency, institution?, tna?, start_date, maturity_date?, amount, current_value?}`. Las fechas las valida el backend con su hoy real: `start_date` no puede ser futura y un plazo fijo que ya venció sale como "vencido".
- Con tarjeta, lo del resumen del mes cuenta en Inicio el mes siguiente: para que haya gastos de tarjeta en el mes actual, cargá compras en el resumen del mes anterior. La cuota n se fecha compra + n−1 meses: una compra del día 20 deja la cuota 2 en el futuro.
- Capturá el flujo que carga un ingreso **antes** de las pantallas si Inicio depende de él (si no, Inicio sale en negativo).
- Reloj: `ctx.clock.setFixedTime(<hoy 15:00 -03:00>)` después de cargar los datos. Divisas y /shared proponen la fecha con `toISOString()` (UTC): después de las 21 h dicen "mañana".
- Los formularios son hojas (`FormSheet`, `role="dialog"` con el título como nombre: "Nuevo egreso", "Nuevo ingreso"…), en un portal sobre `body`: acotá los Locators con `page.getByRole("dialog", { name })`. Los botones de guardar dicen "Guardar egreso", "Guardar ingreso", "Guardar operación", "Crear objetivo".
- El flag `NEXT_PUBLIC_FEATURE_RECONCILE` está apagado: no prometer "Subir resumen". `businessSignup` apagado en local: el alta dice "Crear hogar nuevo", no «Mi hogar».

## Fecha de referencia y corridas de noche (recaptura de 2026-11-01, marca tood)
- Los dos `capture.mjs` usan como "hoy" el 15 del mes anterior cuando el mes calendario va por menos del día 8 (antes 12; o `INSTRUCTIVO_HOY=aaaa-mm-dd`): el día 1 dejaba todos los gastos del mes en la misma fecha, y negocio fallaba con `day(D - 1)` = día 0. Siempre una fecha pasada: el backend recorta tenencia e hipoteca a su hoy real.
- Inicio muestra el **mes calendario** del navegador, no el del día de negocio: a la 1 del día 1 el día de negocio todavía es el mes anterior y Inicio salía vacío. Por eso la decisión mira la fecha calendario.
- La lista de ventas muestra la hora de `created_at`, que pone el backend con su reloj real. De madrugada salían ventas "00:57". Para una corrida nocturna: `INSTRUCTIVO_TZ=<zona> INSTRUCTIVO_HORA=<hh:mm argentina>` (a las 01 h AR: `Pacific/Kiritimati` + `06:30` → ventas a las 18:00 y todo en el mismo día). `businessToday()` usa la zona argentina explícita, así que sólo cambia la hora que se ve.
- (Histórico, antes del rediseño) Imágenes de la landing salían de `frames.json`: hogar `inicio`, `divisas`, `compartidos-persona`; `nuevo-gasto` = paso 6 de `compartir` y `ingreso` = último de `ingreso`, ambas recortadas 24 px arriba (1280×776); negocio `inicio`, `ventas`, `productos`, `egresos` y `nueva-venta` = paso 4 de `venta` (1280×800, con la franja del modal, como siempre). Celular: Inicio de cada cuenta a 390×844, 2×, `isMobile`. `/conectar`: `token.webp` = bloque "Token" recortado a 760×330 CSS con el token nuevo tapado (`rap_pat_` + puntos), `autorizar.webp` = `div.max-w-md` ±16 px a 2×. El script usado está en `/private/tmp/registrapp-instructivo/extra/` (fuera del repo).

## Rediseño (recaptura de 2026-11-11, "vidrio sobre violeta")
- **Fecha de referencia**: los dos `capture.mjs` usan el día real desde el 8 del mes; antes del 8, el 15 del mes anterior (o `INSTRUCTIVO_HOY`). Antes el corte era el 12, y con Objetivos e Inversiones (que dependen del hoy del backend) el navegador y el backend quedaban en fechas distintas.
- **Vidrio a 2×**: lanzar Chromium con `args: ["--enable-gpu", "--ignore-gpu-blocklist"]`. Sin eso, a `deviceScaleFactor: 2` Playwright no dibuja `backdrop-filter` y la barra de abajo del celular sale transparente, con el texto de atrás a la vista. Con las banderas, la captura a 2× sale como en el teléfono.
- **El + del celular** (`aria-label="Agregar"`, hoja "¿Qué pasó?" con Gasté / Me entró plata) sólo existe en el celular de un hogar. El script de hogar graba esos dos flujos en una página de 390×844 y compone cada paso dentro de un cuadro de 1280×800 con forma de teléfono (`pstep`), porque `build_deck.py` tiene una sola proporción por instructivo. En la compu, el + es el FAB ("Registrar egreso", "Nueva operación"…). Un negocio no tiene la hoja: usa el FAB también en el celular.
- **Filas de las listas** (Movimientos y otras): son `button[data-no-press]`. `getByRole("button", { name: /Sueldo Ana/ })` agarra el chip de "¿De dónde entró?", que tiene el mismo texto.
- **Compartidos**: el filtro por persona son `ChoiceChips`, o sea `getByRole("radio", { name: "Lucía Fernández" })`. Con `/Lucía/` como botón se abre la ficha de un gasto ("Con Lucía").
- **El aviso de la t** ("Ingreso guardado", "Egreso guardado"…) aparece unos 3 s después de guardar y tapa lo de abajo (en el celular, el centro de la pantalla). Esperá ~3,5 s antes de capturar un detalle; al final de un flujo puede quedar, porque confirma lo que se hizo.
- **Imágenes de la landing**: se sacan con capturas propias dentro del script, a `/private/tmp/registrapp-instructivo/<sección>/landing/`, y se copian a mano a `frontend/public/`. `nuevo-gasto.jpg` (en el flujo de compartir, con Lucía agregada, antes de guardar) e `ingreso.jpg` (la ficha de Sueldo Ana en escritorio) se recortan a 1280×776 con `clip: {x: 0, y: 24, width: 1280, height: 776}` para mantener el tamaño que espera `/hogar`. Las demás son la pantalla entera a 1280×800 (hogar: `inicio`, `divisas`, `compartidos` = la vista de Lucía, `creditos`, `objetivos`, `inversiones`; negocio: `inicio`, `ventas`, `productos`, `egresos`, `nueva-venta` = el paso del medio de pago). Las del celular: Inicio a 390×844, 2× (`celular-hogar.jpg`, `celular-negocio.jpg`).
- **Modo `EXPLORE`**: `EXPLORE=/dashboard,/objetivos node tools/instructivo/<sección>/capture.mjs` crea las cuentas, carga los datos y saca esas rutas en escritorio y celular (página entera) en `.../explore/`, sin flujos. Sirve para ver una pantalla nueva antes de escribir sus pasos. También deja `state.json` para abrir la cuenta con otro script.
- Las guías del hogar y del negocio se leen del código en los dos scripts (`tourId="…"` + `BUSINESS_TOUR_IDS`).

## Levantar la app
- `docker compose up` (Postgres, backend en :8000, frontend en :3000) y, en otra terminal, `npm run emulator` desde `frontend/` (Firebase Auth en :9099). Si el emulador no responde (`curl 127.0.0.1:9099`), no se puede iniciar sesión.
- Playwright: `frontend/node_modules/playwright/index.mjs`. WebKit no viene instalado (`npx playwright install webkit` si hace falta probar Safari).

## Cuenta de demo
- En `/login` la página expone `window.__e2e` (`ready`, `auth`, `createUserWithEmailAndPassword`): crear el usuario ahí deja la sesión en el localStorage del contexto (después `ctx.storageState`).
- `POST /auth/register` con el token: `{tenant_name, kind: "household" | "business", first_name, last_name, alias}`. `kind: "business"` exige `BUSINESS_SIGNUP_ENABLED` (el compose de desarrollo lo prende).
- `POST /auth/me/skip-whatsapp-gate`: sin esto la app manda a `/onboarding`.
- **Nunca la cuenta de los E2E** (`e2e@registrapp.local`, "E2E Rotisería"): los tests asumen sus datos.
- Correo corto: se ve en la barra lateral (`laura123@demo.local`).

## Guías que hay que marcar como vistas
El script de hogar los saca del código (todos los `tourId="…"` de `app/` y `components/`, más `BUSINESS_TOUR_IDS` y `WHATS_NEW_KEY`). A mano: `localStorage.tour_seen_<id> = "1"` para cada id de `APP_TOUR_IDS` en `frontend/app/(app)/settings/page.tsx` (incluye `BUSINESS_TOUR_IDS` de `components/business/tours.ts`). Un hogar además tiene el carrusel de novedades (`WhatsNewCarousel`, clave versionada `whats_new_seen_*`) y el diálogo de compartidos pendientes: marcarlos o no generar invitaciones pendientes para la cuenta de demo.

## Datos por la API
- Categorías: `GET/POST /expenses/categories`. Un negocio nace con las suyas sembradas.
- Gastos: `POST /expenses/entries {expense_date, amount, category_id, description, payee_id?, stock_lines?}`.
- Negocio: `POST /products`, `POST /payees`, `POST /sales {sale_date, lines: [{product_id, qty, unit_price}], payments}` — **con `unit_price`** o "lo más vendido" queda en 0 —, `PUT /sales/close/{día}`, `POST /stock/movements`.
- Tarjetas: `POST /credit-cards {bank, alias, titular, last_4_digits, due_day}`, `POST /credit-cards/{id}/items {description, category_id, item_date, item_type, amount, installment_count?, year, month}`.
- Recordatorios: `POST /reminders {title, remind_date}`.
- Hogar: ingresos (`/income/sources`, `/income/entries`), divisas (`/currency/...`), hipoteca y compartidos: leé los schemas en `backend/app/schemas/` antes de cargar.
- El día de negocio es de Argentina con corte a las 05:00: calculá "hoy" igual que `services/clock.business_today`.

## Capturas
- `reducedMotion: "reduce"`: el hero de Inicio cuenta desde cero y sin esto se captura a mitad de camino.
- Los modales tienen detrás listas con los mismos textos: acotá los Locators (`[data-tour='sale-products']`, `[data-testid='stock-line']`, `[data-tour='expense-payee']`…). Los combos son `role="combobox"` y sus opciones `role="option"`.

## Conector MCP (lo aprendido en /conectar)
- Script de referencia: `/private/tmp/registrapp-conectar/seed.mjs` (fuera del repo; arma hogar + negocio de demo, llama a las tools y captura). Si no está, se rehace con esto.
- **Tools reales contra la demo**: `POST /oauth/tokens {name, expires_in_days}` con el token de Firebase da un `rap_pat_…`; con él, `POST http://localhost:8000/mcp` con `Accept: application/json, text/event-stream` y un JSON-RPC `tools/call` directo (el servidor es stateless: no hace falta `initialize`). El resultado viene en `result.structuredContent.result` (o `content[0].text`). Borrá los tokens al terminar: si no, aparecen en la captura de Configuración.
- **Página de autorizar con una transacción real**: `POST /oauth/register {client_name:"Claude", redirect_uris:["https://claude.ai/api/mcp/auth_callback"], grant_types:["authorization_code","refresh_token"], response_types:["code"], token_endpoint_auth_method:"none"}` (límite 5/h por IP: guardá el `client_id` en un archivo y reusalo); después `GET /oauth/authorize?response_type=code&client_id=…&redirect_uri=…&code_challenge=<S256>&code_challenge_method=S256&state=…&scope=registrapp:read&resource=http://localhost:8000/mcp` con `redirect: "manual"`: el `Location` es `http://localhost:3000/oauth/authorize?txn=…`. Abrilo en el contexto con la sesión de demo; la tarjeta es `div.max-w-md` (recortá con 16 px de margen o se corta la sombra). No hace falta autorizar.
- En local, Configuración muestra `http://localhost:8000/mcp` como dirección: recortá la captura a la parte del token (`div.space-y-3` con el título "Token") y escribí la de producción en la página.
- Firebase del emulador: `window.__e2e.signInWithEmailAndPassword` sirve para volver a entrar a una cuenta de demo ya creada.

## Dónde va lo publicado
- Assets públicos: `frontend/public/<sección>/` (el instructivo como `instructivo.html` + capturas `.jpg` para la landing).
- Landing: `frontend/app/<sección>/page.tsx` y la vista a pantalla completa en `frontend/app/<sección>/instructivo/page.tsx`, **fuera de `(app)`** (ese layout manda a `/login`). Ejemplo: `/negocio`.
- `frontend/next.config.ts` manda `X-Frame-Options: DENY` a todo: cada instructivo estático nuevo necesita su regla `SAMEORIGIN` (ver la de `/negocio/instructivo.html`).
- La pantalla de login no lleva links extra (nota de diseño en `app/(auth)/login/page.tsx`).
- Deploy: commit con rutas explícitas, `./scripts/deploy.sh`, y verificar en producción las rutas y el header del instructivo.
