# Receta: instructivos de RegistrApp

Lo específico de este proyecto para el agente `instructivo-builder` (`~/.claude/agents/`). Ejemplo completo y funcionando: `tools/instructivo/negocio/` (`capture.mjs` + `deck.json`).

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
`localStorage.tour_seen_<id> = "1"` para cada id de `APP_TOUR_IDS` en `frontend/app/(app)/settings/page.tsx` (incluye `BUSINESS_TOUR_IDS` de `components/business/tours.ts`). Un hogar además tiene el carrusel de novedades (`WhatsNewCarousel`, clave versionada `whats_new_seen_*`) y el diálogo de compartidos pendientes: marcarlos o no generar invitaciones pendientes para la cuenta de demo.

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

## Dónde va lo publicado
- Assets públicos: `frontend/public/<sección>/` (el instructivo como `instructivo.html` + capturas `.jpg` para la landing).
- Landing: `frontend/app/<sección>/page.tsx` y la vista a pantalla completa en `frontend/app/<sección>/instructivo/page.tsx`, **fuera de `(app)`** (ese layout manda a `/login`). Ejemplo: `/negocio`.
- `frontend/next.config.ts` manda `X-Frame-Options: DENY` a todo: cada instructivo estático nuevo necesita su regla `SAMEORIGIN` (ver la de `/negocio/instructivo.html`).
- La pantalla de login no lleva links extra (nota de diseño en `app/(auth)/login/page.tsx`).
- Deploy: commit con rutas explícitas, `./scripts/deploy.sh`, y verificar en producción las rutas y el header del instructivo.
