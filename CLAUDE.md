# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

RegistrApp is a personal finance PWA for tracking UVA mortgage payments vs salary vs inflation in Argentina. Stack: Python 3.12 + FastAPI (async), PostgreSQL 16, Alembic, Next.js 15 App Router + Tailwind CSS, Recharts.

## Local development

```bash
# Start all services (PostgreSQL + backend with hot-reload + frontend with hot-reload)
docker compose up

# Backend only (from /backend, with .env present)
uvicorn app.main:app --reload --port 8000

# Frontend only (from /frontend)
npm run dev

# Lint frontend (from /frontend)
npm run lint

# Create a new Alembic migration
cd backend && alembic revision --autogenerate -m "describe_change"

# Apply migrations manually (runs automatically on container start in prod)
cd backend && alembic upgrade head
```

There are no automated tests (no pytest, no jest setup).

## Deployment

Production uses `docker-compose.prod.yml` which Easypanel pulls from the `main` branch on GitHub. Pushing to `main` and clicking "Deploy" in Easypanel triggers a full rebuild. The frontend `NEXT_PUBLIC_*` variables are **baked in at build time** via Dockerfile.prod `ARG`s — changing them requires a rebuild.

**Firebase credentials**: never committed. The `FIREBASE_CREDENTIALS_B64` env var (base64-encoded JSON) is decoded to `/tmp/firebase-credentials.json` by `backend/entrypoint.sh` at container startup. `entrypoint.sh` also runs `alembic upgrade head` before starting uvicorn, so all pending migrations apply automatically on every deploy.

**CORS**: the backend reads `ALLOWED_ORIGINS` from env (default: `http://localhost:3000`). In production this must include the frontend domain, e.g. `https://registrapp.imanzanastore.com.ar`.

**`FRONTEND_URL`**: used to build invite links in WhatsApp messages (`{FRONTEND_URL}/invite/{token}`). Defaults to `http://localhost:3000`; set to the production domain in Easypanel env vars.

## Git workflow and commits

- **No CI/CD pipeline**: No automated tests run on push. Manual testing via `docker compose up` is required before merge.
- **Main branch deploys directly**: Every push to `main` triggers a rebuild in Easypanel. Avoid pushing incomplete work.
- **Commit messages**: Follow pattern `type: message` (e.g., `feat:`, `fix:`, `refactor:`, `docs:`). Include scope in parentheses for clarity: `feat(shared-expenses): add contact picker`. Keep messages concise.
- **Utilities refactoring**: When adding utility functions, always commit them separately to avoid "breaking build" issues (as seen in recent history: `fix: commit missing normalizePhoneNumber util`). Run `npm run build` locally after adding utilities.

## Architecture

### Multi-tenancy
Every data table has `tenant_id` (FK to `tenants`). The auth flow: Firebase JWT → `get_current_user` dependency verifies the token and returns decoded claims → routers call `_get_db_user()` to look up `User` by `firebase_uid` and get `tenant_id` → all queries filter by `tenant_id`.

### Backend structure
```
backend/app/
  core/       # config (pydantic-settings), database (AsyncSession), firebase (get_current_user)
  models/     # SQLAlchemy ORM — Tenant, User, IncomeSource, IncomeEntry, ExpenseCategory,
              #   ExpenseEntry, MacroVariable, MortgageRecord, MortgageLoan, CreditCard,
              #   CreditCardStatement, CreditCardItem, SharedExpense, SharedExpenseSplit,
              #   TenantContact, PaymentReminder, AppLog
  schemas/    # Pydantic request/response models
  routers/    # FastAPI routers — auth, income, expenses, macro, mortgage, dashboard,
              #   credit_cards, shared_expenses, contacts, reminders, whatsapp, internal_logs
  services/   # (currently unused)
```

All routers follow the pattern: `Depends(get_current_user)` + `Depends(get_db)` → `_get_db_user()` → query with `tenant_id`. Dashboard schemas (`MonthSummary`, `HistoryPoint`) are defined inline in `routers/dashboard.py`.

**Scheduled jobs**: APScheduler runs inside the FastAPI lifespan (each also fires once via `asyncio.create_task` at startup, not just on the cron schedule). Three daily jobs, all UTC: `_daily_sync` at 09:00 (macro BCRA sync), `_daily_mortgage_sync` at 09:01 (updates active mortgage records), `_daily_reminder_check` at 09:02 (sends WhatsApp for due `PaymentReminder`s — see Calendario de pagos below).

**Household (tenant) code**: `Tenant` has a `code: str | None` field (8-char alphanumeric, unique). `POST /auth/register` creates a new tenant with a generated code; `POST /auth/join` accepts `{ tenant_code }` and looks up the tenant by code. `UserOut` includes `tenant_code` via a `@property` on `User` that reads `user.tenant.code` — requires `selectinload(User.tenant)` wherever the user is reloaded after a write. **This applies to every endpoint returning `UserOut` or `list[UserOut]`** — missing the `selectinload` causes a `MissingGreenlet` crash at response serialization time.

**Entry filtering by month**: `GET /income/entries` and `GET /expenses/entries` accept optional `?year=&month=` query params, filtering with SQLAlchemy `extract()`. The dashboard fetches entries pre-filtered to the current calendar month for pie charts.

**Macro sync**: `POST /macro/sync-bcra` fetches UVA, inflation, and USD official rates from `api.argentinadatos.com` using `ESTADISTICAS_BCRA_TOKEN` from env, then upserts into `MacroVariable`. Fallback strategy: exact date match → last record of same month → last record before target date.

**Bulk income import**: `POST /income/import` accepts CSV or Excel. Flexible date parsing handles MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, and others. Duplicate rows (same tenant + source + date + amount) are silently skipped. Response: `{"imported": N, "skipped": N, "errors": []}` with per-row error messages.

### Credit cards (Tarjetas)
Three models: `CreditCard` (card metadata: bank, alias, last 4 digits) → `CreditCardStatement` (year + month period, unique per card; has `closing_date`, `due_date`, `status: "open"|"closed"`) → `CreditCardItem` (individual charges: single/installment/recurring types).

**Key flows**:
- `_find_or_create_statement`: auto-creates a statement for a given year/month if it doesn't exist yet.
- `POST /credit-cards/statements/{stmt_id}/items` (and finalize): each `CreditCardItem` also writes a corresponding `ExpenseEntry` with `payment_method="tarjeta_credito"` and `entity=card.alias`. This keeps expenses visible in the Egresos view.
- `GET /credit-cards/for-expense/{expense_entry_id}`: reverse lookup — given an `ExpenseEntry` id, returns `ForExpenseOut` (card_id, statement_id, year, month) so the frontend can navigate to `/tarjetas/{card_id}/{statement_id}`.
- Expense entries created by credit cards are **read-only from Egresos** — the frontend shows "Ver en resumen" instead of edit/delete buttons, and their checkboxes are hidden (can't bulk-delete them).

Frontend routes: `/tarjetas` → `/tarjetas/[cardId]` (statements list) → `/tarjetas/[cardId]/[statementId]` (items). `PATCH /credit-cards/statements/{id}` lets `closing_date`/`due_date` be corrected after creation (pencil icon on the statements list); `GET /credit-cards/statements/calendar?year=&month=` returns statements from every card in the household whose `closing_date` or `due_date` falls in that calendar month regardless of the statement's own `year`/`month` period — feeds the payment calendar (see below).

**Installment (cuotas) propagation**: when `create_item` receives `item_type="installment"`, it immediately creates all future cuota records (cuotas 2..N) in their respective statements (auto-created via `_find_or_create_statement`). Child cuotas have `installment_group_id` pointing to the root item's `id`; the root has `installment_group_id = NULL`. Edit/delete is blocked on non-root cuotas (400 error); deleting the root cascades all children. `finalize_statement` skips items that already have children (avoids duplicate propagation). `CreditCardItemOut` includes `installment_root_statement_id: int | None` — populated from `installment_group.statement_id` — so the frontend can navigate to the root's statement for non-root cuotas ("Ver original" button).

**Currency (ARS/USD)**: `CreditCardItem` and `ExpenseEntry` both have a `currency VARCHAR(3)` field (default `"ARS"`). USD items are only allowed for `item_type="single"` (validated in schema). The backend auto-assigns the category via `_get_or_create_usd_category(tenant_id, db)` which lazily creates a "Consumo en dólares" category (color `#22c55e`) per tenant on first USD expense — callers don't pass `category_id` for USD. The frontend form shows the ARS/USD toggle at the **top** of the form; selecting USD hides the category selector and (in tarjetas) the tipo selector. Totals in list pages show `arsTotal` and `usdTotal` on separate lines. Use `formatUSD(n)` from `lib/utils.ts` for USD display (`"U$D X,XX"` format).

**Dashboard totals never mix currencies**: `GET /dashboard/summary/{year}/{month}` filters `total_expenses` and `expenses_by_category` to `currency == "ARS"` only, with USD tracked separately in `total_expenses_usd`. `balance` (`total_income - total_expenses`) is therefore ARS-only too. Since every USD entry lands in the single "Consumo en dólares" category, a currency-mixed category breakdown would otherwise double-count it against ARS categories — the dashboard's USD pie chart groups those entries by `description` instead of category (categories would all be identical), folding anything past the top 8 into an "Otros" slice.

### Shared expenses (Gastos compartidos)
`SharedExpense` has a `split_type` ("equal" or "custom") and links to `SharedExpenseSplit` rows (one per participant). Splits track `user_id` (nullable — may be an external guest), `member_name`, `amount`, and `status` ("pending"/"accepted"/"rejected").

**Invite flow**: when creating a shared expense with an external participant, the `invite_contact` field accepts either an email address or a phone number. Detection: `@` in value → email (generates `invite_token`, user copies link); digit string → phone (generates `invite_token` **and** sends a WhatsApp message via Evolution API using `EVOLUTION_API_URL`/`EVOLUTION_INSTANCE`/`EVOLUTION_API_KEY` env vars). The invite link is `{FRONTEND_URL}/invite/{token}` — set `FRONTEND_URL` in env for production. `GET /shared-expenses/invite/{token}` is a public endpoint (no auth). `POST /shared-expenses/invite/{token}/claim` assigns the split to the authenticated user, creates an `ExpenseEntry` in their tenant, and sets status to `"accepted"` in one step. Frontend stores the token in `localStorage("pendingInviteToken")` before redirecting to `/login`; `AuthContext.refreshUser()` auto-claims it after registration/join.

**Cross-tenant visibility**: the load query uses `or_(tenant_id == user.tenant_id, split.user_id == user.id)` so guests see expenses shared with them even if they belong to a different tenant. When a split is accepted, an `ExpenseEntry` is created in the acceptor's expense table.

**Phone number normalization**: when a phone number is entered for WhatsApp invite, it's normalized to international format (`+54934567890`) via `_normalize_phone()` in the backend. The frontend uses `normalizePhoneNumber()` from `lib/utils.ts` to parse device contact picker results and split them into `prefix` (country code like "54") and `local` (number without prefix). The frontend's `buildPhone()` function reconstructs the format expected by the backend: for Argentina, adds "9" after the prefix (`549...`). Always normalize before sending to backend or Evolution API.

### Contacts (household agenda)
`TenantContact` (`routers/contacts.py`) is a **household-wide** address book — unique per `tenant_id + contact_phone`, not per user. It starts empty and auto-populates: `_save_tenant_contact()` in `shared_expenses.py` is called from both the shared-expenses and credit-cards phone-invite branches every time someone invites an external contact by phone, silently skipping if that phone is already saved (even under a different name). `GET /contacts` is used by the shared-expenses form and the credit-card "compartir ítem" modal to offer a "Elegir de la agenda" dropdown when adding an external participant — this is the primary way to pick a known contact on iOS, since the native Contact Picker API isn't usable there (see Device APIs below). There's no dedicated ABM screen yet.

### Calendario de pagos (payment reminders)
`PaymentReminder` (`routers/reminders.py`) is a **household-wide** freeform reminder: `title` + `remind_date`, optionally linked to a `statement_id` (`SET NULL` on delete). `GET /reminders?year=&month=` / `POST /reminders` / `DELETE /reminders/{id}` are the CRUD; any member of the tenant can see/delete any reminder, but `user_id` (the creator) is who gets notified. The `/calendario` frontend page renders a month grid combining `GET /credit-cards/statements/calendar` (closing/due dates, orange/red dots) with `GET /reminders` (violet dots) built with `date-fns` — no calendar UI library is used, just `startOfWeek`/`eachDayOfInterval`/etc. Clicking a day opens a panel to add a reminder for that date.

`send_due_reminders()` (called by the `_daily_reminder_check` scheduled job) WhatsApps each reminder due today to its creator via `_send_wa_msg`, then marks it `notified=True` regardless of send outcome (fire-once semantics — failures are logged, not retried). **Only works if that specific user has linked their own WhatsApp number** (`user.whatsapp_phone`) via `/auth/me/link-whatsapp` in Settings; otherwise the reminder still shows on the calendar but silently skips the WhatsApp.

### Internal diagnostics
`routers/internal_logs.py` exposes `/internal/*` endpoints gated by a shared-secret header (`x-internal-key` must match the `INTERNAL_LOG_KEY` env var), not user auth — used for ops/debugging, never called from the frontend:
- `GET /internal/logs`, `GET /internal/logs/summary`, `POST /internal/logs/frontend-error` — read/write `AppLog` rows.
- `GET /internal/pending-shared-invites` — diagnostic listing of `SharedExpenseSplit` rows (optionally filtered by `creator_email`) to distinguish already-registered recipients (visible in-app, `user_id` set) from external invites still waiting on `invite_token`.
- `POST /internal/backfill-shared-invite-claims` — one-off data-repair tool that replicates `POST /shared-expenses/invite/{token}/claim` (assign `user_id`, create the `ExpenseEntry`, mark `accepted`) keyed by `{split_id, user_id}` pairs instead of a token, for manually linking splits whose invite never got delivered.
- `GET /internal/tenant-contacts` / `DELETE /internal/tenant-contacts/{id}` — read and clean up the household agenda (`TenantContact`) directly, e.g. to remove stale/duplicate entries.
- `GET /internal/whatsapp-check?phone=` — calls Evolution's own `/chat/whatsappNumbers/{instance}` lookup (no message sent) for a phone in several plausible AR formats (with/without the leading 9, bare local). Useful because Evolution's dedicated lookup and its `/message/sendText` endpoint's internal existence check don't always agree — see Phone number handling below.

The root `mcp/server.py` (a FastMCP stdio server registered in `.mcp.json` as `registrapp-logs`) wraps the `/internal/logs*` endpoints as Claude Code tools (`recent_errors`, `search_logs`, `logs_by_module`, `log_summary`), authenticating with `MCP_INTERNAL_KEY` against the same `INTERNAL_LOG_KEY`. It only covers the log endpoints — the other `/internal/*` diagnostics above are called directly with `curl` + the same key.

### Frontend structure
```
frontend/app/
  (auth)/login/     # Google sign-in page
  onboarding/       # First-time tenant creation
  (app)/            # Protected layout (sidebar + auth guard)
    dashboard/      # Monthly summary cards + pie charts (categories, income sources, USD by
                    #   description) — all always current calendar month, independent of the
                    #   month selector used for the summary cards
    income/         # Income entries with bruto/deducciones/neto + bulk import from Excel/CSV
    expenses/       # Expense entries; credit card entries show badge + "Ver en resumen" only
    mortgage/       # UVA mortgage payment records
    macro/          # Macro variables (UVA value, inflation, USD)
    settings/       # User/tenant settings
    shared/         # Shared expense list with accept/reject
    tarjetas/       # Credit cards → [cardId] (statements) → [cardId]/[statementId] (items)
    calendario/     # Monthly payment calendar (statement dates + reminders)
frontend/
  contexts/AuthContext.tsx   # Firebase auth state + /auth/me → appUser
  lib/api.ts                 # Axios instance; adds Firebase ID token to every request
  lib/utils.ts               # formatARS, formatUSD, formatPct, parseAmount, normalizePhoneNumber, cn()
```

**Device APIs (PWA-specific)**: The app uses the Web Contact Picker API (`navigator.contacts.select()`) to let users pick contacts from their device. **In practice this only works on Chrome/Edge for Android — Safari on iOS does not support it**, even in "Add to Home Screen" standalone mode, unless the user manually enables an experimental flag (unrealistic for real users). Always wrap contact picker calls in try-catch, check `"contacts" in navigator` before calling, and give the user visible feedback (not a silent no-op) when unsupported — the household agenda (`TenantContact`, see above) is the practical fallback for iOS. When picking contacts, normalize the phone number result via `normalizePhoneNumber()` before using.

`AuthContext` exposes `firebaseUser`, `appUser`, `loading`, and `refreshUser()`. `refreshUser()` re-fetches `GET /auth/me` **and then auto-claims any `pendingInviteToken` stored in localStorage** — call it after register/join to complete the invite flow. The `(app)` layout redirects to `/login` if not authenticated, or `/onboarding` if authenticated but no `appUser` (tenant not created yet).

**Scroll reset**: the `<main id="main-content">` in `(app)/layout.tsx` has `overflow-auto`, so the browser doesn't reset scroll on navigation. The `ScrollToTop` component (`frontend/components/ScrollToTop.tsx`) uses `usePathname()` to scroll `#main-content` to top on every route change — it must stay inside the layout.

## Known quirks

### asyncpg + GROUP BY date_trunc
asyncpg parameterizes literal string arguments to functions, assigning different `$N` indices in SELECT vs GROUP BY. PostgreSQL rejects this. **Always use `text("1")` (positional grouping) instead of repeating the expression:**
```python
from sqlalchemy import text
select(func.date_trunc("month", col).label("p"), func.sum(...))
.group_by(text("1"))  # NOT .group_by(func.date_trunc("month", col))
```

### Recharts SSR in Next.js App Router
Even `"use client"` pages are SSR'd. Recharts uses `window`/`ResizeObserver` which doesn't exist on the server, so charts render empty. Gate all chart rendering behind a `mounted` state:
```tsx
const [mounted, setMounted] = useState(false);
useEffect(() => { setMounted(true); }, []);
// Only render charts when: mounted && !loading && data.length > 0
```

### Alembic migrations
- `down_revision` must point to the current HEAD (check `alembic/versions/` for the latest file)
- The model import in `alembic/env.py` (`import app.models`) auto-discovers all tables via `Base.metadata`
- New nullable columns can go live before the migration runs (asyncpg won't error on missing optional columns), but non-nullable columns will break the backend until migrated
- Use `IF NOT EXISTS` for idempotency — if a deploy fails mid-migration, Alembic won't mark it complete and will retry on next deploy. Use `op.execute(sa.text("ALTER TABLE ... ADD COLUMN IF NOT EXISTS ..."))` and `CREATE UNIQUE INDEX IF NOT EXISTS` to make migrations safe to re-run

### Form field visual consistency
All form inputs (text, number, date, select) must share the same CSS classes so they look identical. Define a constant like `const INPUT = "w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-900"` at the top of each page and apply it everywhere. Never let the browser default style for `type="date"` take over — always force `bg-white text-gray-900`.

### Amount fields
Use `type="text" inputMode="decimal" pattern="[0-9.,]*"` instead of `type="number"` for currency inputs. `type="number"` causes UX issues on mobile and with large Argentine peso values.

When reading user-entered amounts, always use `parseAmount(value)` from `lib/utils.ts` — never `parseFloat(value)` directly. `parseFloat("9,99")` returns `9` in JavaScript (stops at comma). `parseAmount` normalizes Argentine format first: removes thousands dots, replaces decimal comma with dot, then calls `parseFloat`.

### Phone number handling
Phone numbers are stored in international format (+54934567890) but entered via user input, device contacts, or WhatsApp messages. Always normalize before database operations:
- **Frontend**: Use `normalizePhoneNumber(rawInput)` from `lib/utils.ts` to parse unstructured input. Returns `{prefix, local, isValid}`.
- **Backend**: Use `_normalize_phone(value)` from `routers/shared_expenses.py` to normalize before storing/comparing. It always inserts the mandatory `9` after the `54` country code for Argentine numbers (even for a bare 10-digit local input) — don't reintroduce a code path that only *preserves* a `9` the caller already included, that silently produces invalid JIDs for the common case of a freshly-typed number.
- **Evolution API**: Expects full international format like `+54934567890`.
- **User lookups**: Compare normalized forms: both stored (`user.whatsapp_phone`) and incoming must be normalized first. Note `user.whatsapp_phone` is set directly from `WhatsAppVerifyRequest.phone` in `/auth/me/verify-whatsapp` without going through `_normalize_phone` — a stored number can therefore fail to match a freshly-normalized comparison value if the frontend ever sends it in a different shape.
- **Sending is a two-step resolve-then-send, not a direct `sendText` call**: Evolution API's `/message/sendText/{instance}` endpoint has its own internal number-existence check that is stricter (and inconsistent) with its dedicated `/chat/whatsappNumbers/{instance}` lookup endpoint — a number the lookup confirms `exists: true` can still get rejected by `sendText` with `exists: false` for the exact same string. `_resolve_whatsapp_jid()` in `shared_expenses.py` calls the lookup endpoint first and sends to whatever canonical number it returns (falling back to the locally-normalized number only if the lookup itself fails); both `_send_wa_msg` and `/auth/me/link-whatsapp` go through it. Diagnose future "WhatsApp doesn't arrive" reports with `GET /internal/whatsapp-check?phone=` before assuming it's a formatting bug.
