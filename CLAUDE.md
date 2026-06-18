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

# Create a new Alembic migration
cd backend && alembic revision --autogenerate -m "describe_change"

# Apply migrations manually (runs automatically on container start in prod)
cd backend && alembic upgrade head
```

## Deployment

Production uses `docker-compose.prod.yml` which Easypanel pulls from the `main` branch on GitHub. Pushing to `main` and clicking "Deploy" in Easypanel triggers a full rebuild. The frontend `NEXT_PUBLIC_*` variables are **baked in at build time** via Dockerfile.prod `ARG`s — changing them requires a rebuild.

**Firebase credentials**: never committed. The `FIREBASE_CREDENTIALS_B64` env var (base64-encoded JSON) is decoded to `/tmp/firebase-credentials.json` by `backend/entrypoint.sh` at container startup. `entrypoint.sh` also runs `alembic upgrade head` before starting uvicorn, so all pending migrations apply automatically on every deploy.

**CORS**: the backend reads `ALLOWED_ORIGINS` from env (default: `http://localhost:3000`). In production this must include the frontend domain, e.g. `https://registrapp.imanzanastore.com.ar`.

## Architecture

### Multi-tenancy
Every data table has `tenant_id` (FK to `tenants`). The auth flow: Firebase JWT → `get_current_user` dependency verifies the token and returns decoded claims → routers call `_get_db_user()` to look up `User` by `firebase_uid` and get `tenant_id` → all queries filter by `tenant_id`.

### Backend structure
```
backend/app/
  core/       # config (pydantic-settings), database (AsyncSession), firebase (get_current_user)
  models/     # SQLAlchemy ORM — Tenant, User, IncomeSource, IncomeEntry, ExpenseCategory,
              #   ExpenseEntry, MacroVariable, MortgageRecord
  schemas/    # Pydantic request/response models
  routers/    # FastAPI routers — auth, income, expenses, macro, mortgage, dashboard
  services/   # (currently unused)
```

All routers follow the pattern: `Depends(get_current_user)` + `Depends(get_db)` → `_get_db_user()` → query with `tenant_id`. Dashboard schemas (`MonthSummary`, `HistoryPoint`) are defined inline in `routers/dashboard.py`.

### Frontend structure
```
frontend/app/
  (auth)/login/     # Google sign-in page
  onboarding/       # First-time tenant creation
  (app)/            # Protected layout (sidebar + auth guard)
    dashboard/      # Monthly summary cards + historical Recharts charts
    income/         # Income entries with bruto/deducciones/neto + bulk import from Excel/CSV
    expenses/       # Expense entries by category
    mortgage/       # UVA mortgage payment records
    macro/          # Macro variables (UVA value, inflation, USD)
    settings/       # User/tenant settings
frontend/
  contexts/AuthContext.tsx   # Firebase auth state + /auth/me → appUser
  lib/api.ts                 # Axios instance; adds Firebase ID token to every request
  lib/utils.ts               # formatARS, formatPct, cn()
```

`AuthContext` exposes `firebaseUser`, `appUser`, and `loading`. The `(app)` layout redirects to `/login` if not authenticated, or `/onboarding` if authenticated but no `appUser` (tenant not created yet).

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
