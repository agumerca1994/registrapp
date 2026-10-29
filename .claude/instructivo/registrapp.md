# Receta: instructivos de RegistrApp

Lo específico de este proyecto para el agente `instructivo-builder` (`~/.claude/agents/`). Ejemplos completos y funcionando: `tools/instructivo/negocio/` y `tools/instructivo/hogar/` (`capture.mjs` + `deck.json`). El de hogar usa `recorder()` del kit y lee las guías y la clave del carrusel del código (ver abajo); preferilo como base.

## Hogar (lo aprendido en /hogar)
- Tres cuentas por corrida: el dueño (sesión de la página), un miembro que se suma con `POST /auth/join {tenant_code}` y una amiga con su propio hogar para compartidos. Las otras dos se crean en un segundo contexto, así la sesión del principal no cambia.
- Compartidos sin diálogo pendiente: el dueño crea uno con la amiga y ella lo acepta; ella crea otro con el dueño y **él lo acepta por la API** antes de capturar. Crear un compartido con alguien sin dispositivo ni WhatsApp vinculado no manda nada en local (no hay error).
- Hipoteca: `POST /mortgage/loans` con `first_payment_date` pasado registra sola las cuotas vencidas como egresos, pero sólo los meses con UVA en `macro_variables` (en local desde 2025-01): arrancar el préstamo en 2025.
- Con tarjeta, lo del resumen del mes cuenta en Inicio el mes siguiente: para que haya gastos de tarjeta en el mes actual, cargá compras en el resumen del mes anterior. La cuota n se fecha compra + n−1 meses: una compra del día 20 deja la cuota 2 en el futuro.
- Capturá el flujo que carga un ingreso **antes** de las pantallas si Inicio depende de él (si no, Inicio sale en negativo).
- Reloj: `ctx.clock.setFixedTime(<hoy 15:00 -03:00>)` después de cargar los datos. Divisas y /shared proponen la fecha con `toISOString()` (UTC): después de las 21 h dicen "mañana".
- Trampa visual conocida (bug de la app): los modales viven dentro de un `space-y-*` y el `margin-top` corre el fondo oscuro 24 px; las capturas con modal tienen una franja clara arriba. Para la landing se recortó con un clip de Playwright (`sips -c` no recorta).
- El flag `NEXT_PUBLIC_FEATURE_RECONCILE` está apagado: no prometer "Subir resumen". `businessSignup` apagado en local: el alta dice "Crear hogar nuevo", no «Mi hogar».

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
