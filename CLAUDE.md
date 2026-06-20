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

## Architecture

### Multi-tenancy
Every data table has `tenant_id` (FK to `tenants`). The auth flow: Firebase JWT → `get_current_user` dependency verifies the token and returns decoded claims → routers call `_get_db_user()` to look up `User` by `firebase_uid` and get `tenant_id` → all queries filter by `tenant_id`.

### Backend structure
```
backend/app/
  core/       # config (pydantic-settings), database (AsyncSession), firebase (get_current_user)
  models/     # SQLAlchemy ORM — Tenant, User, IncomeSource, IncomeEntry, ExpenseCategory,
              #   ExpenseEntry, MacroVariable, MortgageRecord, CreditCard, CreditCardStatement,
              #   CreditCardItem, SharedExpense, SharedExpenseSplit, UserContact
  schemas/    # Pydantic request/response models
  routers/    # FastAPI routers — auth, income, expenses, macro, mortgage, dashboard,
              #   credit_cards, shared_expenses, contacts, whatsapp
  services/   # (currently unused)
```

All routers follow the pattern: `Depends(get_current_user)` + `Depends(get_db)` → `_get_db_user()` → query with `tenant_id`. Dashboard schemas (`MonthSummary`, `HistoryPoint`) are defined inline in `routers/dashboard.py`.

**Scheduled jobs**: APScheduler runs inside the FastAPI lifespan. Two daily jobs at 09:00 and 09:01 UTC: `_daily_sync` (macro BCRA sync) and `_daily_mortgage_sync` (updates active mortgage records).

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

Frontend routes: `/tarjetas` → `/tarjetas/[cardId]` (statements list) → `/tarjetas/[cardId]/[statementId]` (items).

### Shared expenses (Gastos compartidos)
`SharedExpense` has a `split_type` ("equal" or "custom") and links to `SharedExpenseSplit` rows (one per participant). Splits track `user_id` (nullable — may be an external guest), `member_name`, `amount`, and `status` ("pending"/"accepted"/"rejected").

**Invite flow**: when creating a shared expense with an external participant, the `invite_contact` field accepts either an email address or a phone number. Detection: `@` in value → email (generates `invite_token`, user copies link); digit string → phone (generates `invite_token` **and** sends a WhatsApp message via Evolution API using `EVOLUTION_API_URL`/`EVOLUTION_INSTANCE`/`EVOLUTION_API_KEY` env vars). The invite link is `{FRONTEND_URL}/invite/{token}` — set `FRONTEND_URL` in env for production. `GET /shared-expenses/invite/{token}` is a public endpoint (no auth). `POST /shared-expenses/invite/{token}/claim` assigns the split to the authenticated user, creates an `ExpenseEntry` in their tenant, and sets status to `"accepted"` in one step. Frontend stores the token in `localStorage("pendingInviteToken")` before redirecting to `/login`; `AuthContext.refreshUser()` auto-claims it after registration/join.

**Cross-tenant visibility**: the load query uses `or_(tenant_id == user.tenant_id, split.user_id == user.id)` so guests see expenses shared with them even if they belong to a different tenant. When a split is accepted, an `ExpenseEntry` is created in the acceptor's expense table.

### Frontend structure
```
frontend/app/
  (auth)/login/     # Google sign-in page
  onboarding/       # First-time tenant creation
  (app)/            # Protected layout (sidebar + auth guard)
    dashboard/      # Monthly summary cards + line chart + two pie charts (both always current month)
    income/         # Income entries with bruto/deducciones/neto + bulk import from Excel/CSV
    expenses/       # Expense entries; credit card entries show badge + "Ver en resumen" only
    mortgage/       # UVA mortgage payment records
    macro/          # Macro variables (UVA value, inflation, USD)
    settings/       # User/tenant settings
    shared/         # Shared expense list with accept/reject
    tarjetas/       # Credit cards → [cardId] (statements) → [cardId]/[statementId] (items)
frontend/
  contexts/AuthContext.tsx   # Firebase auth state + /auth/me → appUser
  lib/api.ts                 # Axios instance; adds Firebase ID token to every request
  lib/utils.ts               # formatARS, formatPct, cn()
```

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
