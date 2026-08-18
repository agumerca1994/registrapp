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

There are no backend or unit tests (no pytest, no jest). The only automated suite is Playwright E2E in `frontend/e2e/` — `npm run test:e2e` from `/frontend`, which needs `npm run emulator` (Firebase Auth emulator) and `docker compose up` running in separate terminals. Adding a route means adding it to the `ROUTES` arrays in `e2e/smoke.spec.ts` and `e2e/visual.spec.ts`, and any new `tourId` to `e2e/auth.setup.ts`.

## Deployment

Production uses `docker-compose.prod.yml` which Easypanel pulls from the `main` branch on GitHub. Pushing to `main` and clicking "Deploy" in Easypanel triggers a full rebuild. The same rebuild is fired from the command line by `scripts/deploy.sh`, which wraps the webhook in `.deploy.env` (gitignored — it's a bearer credential and this repo is public):

```bash
./scripts/deploy.sh          # chequeos + confirmación + deploy
./scripts/deploy.sh --check  # solo los chequeos, no dispara nada
./scripts/deploy.sh --yes    # sin confirmación (para atajos/automatización)
```

**The preflight is the point, not the curl.** Easypanel builds whatever `main` holds *on GitHub*, so the webhook's outcome is decided by state the webhook never looks at: firing it with local `main` ahead of the remote deploys the previous commit, firing it with a dirty tree deploys something that isn't what's on screen, and neither shows up in the response. The script refuses (unless `--force`) when the branch isn't `main`, the tree is dirty, or HEAD and `origin/main` have diverged, and prints the exact commit subject it is about to ship. It also confirms interactively, because there's no dry run on Easypanel's side — any request to that path starts a rebuild.

Committing and pushing has its own wrapper, `scripts/commit-push.sh` — and the reason it exists is a safety rule, not convenience. **It stages with `git add -u`, never `git add -A`.** This repo carries `_staging_<bank>/` folders holding real credit-card statements, not all of them gitignored, and the repo is public; one distracted `add -A` publishes them, and a revert doesn't take it back — the data stays in the history and in any fork. `add -u` touches only already-tracked files and can never add a new one. The cost is that a genuinely new file doesn't get committed by itself, so the script prints every untracked file it is leaving out (flagged, with the `_staging_` warning) and you `git add` it by hand. Message comes from `$MSG`, `$1`, or an interactive prompt; `--no-push` stops after the commit.

All of it is wired as VS Code tasks (Cmd+Shift+P → "Tasks: Run Task") with keyboard shortcuts: `Cmd+Alt+G` commit+push, `Cmd+Shift+Alt+D` deploy, `Cmd+Alt+C` the deploy preflight alone, `Cmd+Shift+B` the frontend build. **The deploy binding carries Shift because macOS eats the obvious one**: `Cmd+Alt+D` is the system's show/hide-Dock hotkey (symbolic hotkey 52, on by default), so it never reaches VS Code — pressing it toggles the Dock and the task silently doesn't run. Don't "simplify" it back. Two deliberate details: the build is the *default* build task, so the easiest shortcut goes to the action that can't break production; and every task runs in the integrated terminal and confirms there, so a mis-hit shortcut never commits or deploys on its own. The task file is duplicated at `/Users/agustin/Proyectos/.vscode/tasks.json` (outside the repo, not committed) because VS Code only reads the `.vscode/` of the folder that is actually open, and that machine has the parent folder open — the labels are identical in both, so the shortcuts work either way.

Two things about it, both found the hard way:
- **The URL Easypanel shows uses whatever host you opened the panel with.** Entering by the internal `159.112.147.178:3000` yields a webhook on that address, and that port isn't published — it times out from anywhere but the server itself. The one that works is the panel's own domain (`imanzanastore.com.ar`).
- **There is no way to test it without deploying.** Any request to that path starts a rebuild; there's no dry run. Treat firing it as the deploy it is.

The rebuild is rolling: `registrapp.imanzanastore.com.ar` kept answering 200 throughout, so a deploy doesn't take the site down. It still doesn't return a build id or status — to know whether the new image actually came up you check the app (or Easypanel's own logs), not the webhook's response. The frontend `NEXT_PUBLIC_*` variables are **baked in at build time** via Dockerfile.prod `ARG`s — changing them requires a rebuild.

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
              #   TenantContact, PaymentReminder, AppLog, CurrencyOperation
  schemas/    # Pydantic request/response models
  routers/    # FastAPI routers — auth, income, expenses, macro, mortgage, dashboard,
              #   credit_cards, shared_expenses, contacts, reminders, whatsapp, currency,
              #   internal_logs, oauth (MCP connector)
  services/   # currency.py  — RATE_TYPES, USD holding formula, USD category helper
              # analytics.py — tenant-scoped aggregations, auth-free (dashboard + MCP)
              # search.py    — accent-folded LIKE shared by the list endpoints' search boxes
              # oauth_provider.py, mcp_tokens.py, rate_limit.py — MCP connector auth
  mcp_server/ # Read-only MCP connector served at /mcp (see "Conector MCP" below)
```

All routers follow the pattern: `Depends(get_current_user)` + `Depends(get_db)` → `_get_db_user()` → query with `tenant_id`. `routers/dashboard.py` is now a thin shell: its schemas (`MonthSummary`, `HistoryPoint`, re-exported for back-compat) and all its queries live in `services/analytics.py` as plain `(db, tenant_id, ...)` functions, so the MCP connector can reuse them without a Firebase token. Put new aggregations there, not in a router.

**Scheduled jobs**: APScheduler runs inside the FastAPI lifespan (each also fires once via `asyncio.create_task` at startup, not just on the cron schedule). Three daily jobs, all UTC: `_daily_sync` at 09:00 (macro BCRA sync), `_daily_mortgage_sync` at 09:01 (updates active mortgage records), `_daily_reminder_check` at 09:02 (sends WhatsApp for due `PaymentReminder`s — see Calendario de pagos below).

**Household (tenant) code**: `Tenant` has a `code: str | None` field (8-char alphanumeric, unique). `POST /auth/register` creates a new tenant with a generated code; `POST /auth/join` accepts `{ tenant_code }` and looks up the tenant by code. `UserOut` includes `tenant_code` via a `@property` on `User` that reads `user.tenant.code` — requires `selectinload(User.tenant)` wherever the user is reloaded after a write. **This applies to every endpoint returning `UserOut` or `list[UserOut]`** — missing the `selectinload` causes a `MissingGreenlet` crash at response serialization time.

**Re-tenanting an existing user is gated on the current household being empty, not on being alone in it.** Both `register` and `join` have a branch that moves an already-registered `User` row to another tenant; it's there for someone who left a household (or was removed) and is parked in the placeholder tenant `_move_to_new_solo_tenant` gave them. It used to be gated on `member_count > 1` alone, which meant a *solo* user with a fully loaded household could create or join another one: the row moves, the old tenant stays behind with every income, expense and card still in it, and nothing about the request looks like data loss. `_assert_can_leave_current_tenant()` now also refuses when `_tenant_has_data()` finds anything in the tables that carry real value (entries, FX operations, cards, mortgage records, shared expenses, reminders — deliberately *not* categories and sources, which get auto-created and would make an untouched household look occupied). Reachable through the UI only after `clearUser()` sends you back to `/onboarding`, but it's a plain authenticated `POST` away for anyone else, and the e2e `auth.setup` hits it on every run.

**Mandatory WhatsApp verification gate (new accounts only)**: `User.whatsapp_gate_pending` (bool, `server_default=false`) is set `True` only in the branch of `register`/`join` that creates a brand-new `User` row — never in the "existing user re-tenants" branch (used after `leave-household`/`remove_member`), so a user who leaves and joins another household is never re-gated. `verify_whatsapp` clears it. Since it defaults `False`, pre-existing users are unaffected. `(app)/layout.tsx` treats `appUser.whatsapp_gate_pending === true` the same as "no appUser" (redirects to `/onboarding`), and `onboarding/page.tsx` shows a second step (mandatory phone OTP form) after tenant creation whenever the flag comes back `true` in the register/join response. Because Evolution API being down would otherwise hard-lock new signups out of the app, there's an escape hatch: `POST /auth/me/skip-whatsapp-gate` clears the flag without verifying, exposed as a "No recibí un código, verificar más tarde" link — only in the onboarding step, not in Settings (see below).

**Two distinct invite flows in Settings — don't conflate them**: the "Tu hogar" card's WhatsApp button (`shareHouseholdCodeByWhatsApp`) opens `wa.me/?text=...` (no fixed number, lets the user pick any contact) with a message containing the tenant join code — this invites someone into *your* household. `InviteFriendSection` ("Invitar amigo") looks similar (also has Email/WhatsApp send options) but sends a generic app referral with no join code — the recipient signs up and creates their *own* separate household. Both build their message via a shared helper (`buildHouseholdInviteMessage` vs `buildFriendInviteMessage`) — reuse those instead of inlining a third invite message if this grows again.

**Entry filtering by month**: `GET /income/entries` and `GET /expenses/entries` accept optional `?year=&month=` query params, filtering with SQLAlchemy `extract()`. The dashboard fetches entries pre-filtered to the current calendar month for pie charts. Both also take the search/filter/sort params described under "The two server-side search endpoints share their matching rules" in the frontend section — `year`/`month` and those filters are alternatives, not companions.

**Searching income (`GET /income/entries`)** also takes `q`, `source_id`, `date_from`, `date_to`, `sort` (`date`/`source`/`amount`) and `order`. Two things about it are deliberate and easy to undo by accident:
- `q` is matched against **both the source name and `notes`**. Income has no "categoría" or "descripción" column — the source is what plays the first role and the free-text notes the second — and which one the user means depends on how they filled the entry in, so one box searches both. Matching is accent-insensitive via `translate()` on both sides rather than `unaccent()`, which would need the extension installed by a migration.
- **A filter takes the list out of the month view entirely.** The frontend drops `year`/`month` as soon as any filter is set and hides the month selector rather than leaving it visible but inert — a search scoped to the month that happens to be on screen misses what the user is looking for and gives no sign that it did. The endpoint doesn't enforce this; passing both just intersects.

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

**The statements list collapses everything after the current month into one row.** Instalment propagation creates every future statement up front and `GET /credit-cards/{id}/statements` returns them newest-first, so a single 12-cuota purchase buries the month the user came to see under eleven statements that exist only as commitments — measured on the reference data, 11 of a card's 12 statements were future. `/tarjetas/[cardId]` buckets by period against the current month and puts each side behind a collapsed toggle — `Próximos resúmenes (N)` above, `Resúmenes anteriores (N)` below — leaving the current month's statement between them as the only paper on screen. Expanding either lists them exactly as before. With both closed the page *is* the "one statement per card per month" view, reached without a month selector. The toggle is **dashed**, the same signal the `locked` Chip and the `estimado` due-date badge use — those statements aren't documents the bank has sent, they're commitments. Deliberately no total or next-due-date on the collapsed row: that framing belongs to the dashboard's commitments, and repeating it here turns a disclosure control into a second summary.

Two things the buckets have to get right. **A card can have no statement for the current month** (the bank hasn't closed it, nothing was charged) — two collapsed rows over an empty page reads as a screen that failed to load, so the past group opens by default in exactly that case; an explicit toggle always wins, which is why its state is `boolean | null` rather than `boolean`. And **the "Fin del historial" divider only renders while the past is expanded or absent**: announcing the end of the history directly under a row that is holding it closed is a lie. `PATCH /credit-cards/statements/{id}` lets `closing_date`/`due_date` be corrected after creation (pencil icon on the statements list); `GET /credit-cards/statements/calendar?year=&month=` returns statements from every card in the household whose `closing_date` or `due_date` falls in that calendar month regardless of the statement's own `year`/`month` period — feeds the payment calendar (see below).

**Installment (cuotas) propagation**: when `create_item` receives `item_type="installment"`, it immediately creates all future cuota records (cuotas 2..N) in their respective statements (auto-created via `_find_or_create_statement`). Child cuotas have `installment_group_id` pointing to the root item's `id`; the root has `installment_group_id = NULL`. Edit/delete is blocked on non-root cuotas (400 error); deleting the root cascades all children. `finalize_statement` skips items that already have children (avoids duplicate propagation). `CreditCardItemOut` includes `installment_root_statement_id: int | None` — populated from `installment_group.statement_id` — so the frontend can navigate to the root's statement for non-root cuotas ("Ver original" button).

**Currency (ARS/USD)**: `CreditCardItem` and `ExpenseEntry` both have a `currency VARCHAR(3)` field (default `"ARS"`). USD items are only allowed for `item_type="single"` (validated in schema). The backend auto-assigns the category via `_get_or_create_usd_category(tenant_id, db)` which lazily creates a "Consumo en dólares" category (color `#22c55e`) per tenant on first USD expense — callers don't pass `category_id` for USD. The frontend form shows the ARS/USD toggle at the **top** of the form; selecting USD hides the category selector and (in tarjetas) the tipo selector. Totals in list pages show `arsTotal` and `usdTotal` on separate lines. Use `formatUSD(n)` from `lib/utils.ts` for USD display (`"U$D X,XX"` format).

**Dashboard totals never mix currencies**: `GET /dashboard/summary/{year}/{month}` keeps `total_expenses`/`total_income`/`balance` to `currency == "ARS"`, with USD in `total_expenses_usd`/`total_income_usd`/`balance_usd`. `GET /dashboard/history` applies the same ARS filter (it didn't until the Divisas work — USD amounts were being added to the peso series as if they were pesos). The one place both currencies appear together is `expenses_by_category`, which carries `total` (ARS) and `total_usd` side by side plus an `ars_equivalent` used only to rank and to size the bars — the amounts themselves are never summed, so it stays visible what was paid in what. Since every USD entry lands in the single "Consumo en dólares" category, a currency-mixed category breakdown would otherwise double-count it against ARS categories — the dashboard's USD pie chart groups those entries by `description` instead of category (categories would all be identical), folding anything past the top 8 into an "Otros" slice.

### One-off bulk statement imports (`backend/scripts/`)
Historical credit-card statement PDFs (per bank) get imported into production for a specific tenant via standalone scripts run manually — not through the API or any UI. One script per bank (`import_bbva_statements.py`, `import_naranjax_statements.py`, ...), intentionally **not** sharing code between banks even though the DB-writing plumbing is nearly identical: each bank's statement layout needs its own from-scratch parser, and each script must keep working standalone since more statements get imported for a given bank long after the next bank's script is written.

Each script exposes the same four subcommands:
- `extract <pdf...>` — parses PDFs into JSON under `backend/scripts/_staging_<bank>/` (gitignored), no DB access. Splits a single PDF into one entry per physical cardholder, since a bank's resumen can consolidate multiple cards/titulares into one document.
- `cards` / `categories --email <email>` — read-only listing of the tenant's existing `CreditCard`/`ExpenseCategory` rows, to fill into the JSON by hand.
- `import <json> --email <email> --dry-run|--commit [--force-import stmt_idx:item_idx,...]` — resolves the card (`existing_card_id` or `create_new`+`new_alias`) and statement (year/month, auto-created if missing), then inserts each item plus its mirrored `ExpenseEntry`, reusing the same currency/category/cuota-propagation rules as `POST /credit-cards/statements/{id}/items`. Flags a duplicate whenever an item's amount matches an existing item already in the same statement — a deliberately blunt heuristic, since same-amount-different-merchant collisions are common (recurring subscriptions, two people on the same flight, etc); these are skipped by default and need `--force-import` after manually confirming they aren't real dupes.

The staged JSON needs manual editing before `import` will accept it: `category_id` per ARS item (USD auto-resolves to "Consumo en dólares"), and `existing_card_id`/`create_new` per card block. `is_latest_statement: true` on exactly one (the most recent) statement per card enables forward cuota-propagation for still-open installment plans, mirroring what the live `create_item` endpoint does — required here because these scripts bypass that endpoint entirely.

These scripts need Python 3.10+ to run locally — they import the real `app.models`, whose `Mapped[X | None]` column annotations are evaluated eagerly and crash under the system's Python 3.9. There's a dedicated `backend/.venv-import/` for this (gitignored, separate from the app's own container image). Production Postgres has no exposed port, so running `import --commit` against prod means copying the script + staged JSON into the running `registrapp-backend` container (which already has `DATABASE_URL` wired to `registrapp-db` internally) and executing there via `docker exec`, not from a local machine over a tunnel.

### Divisas (tenencia en dólares)
`CurrencyOperation` (`routers/currency.py`, `services/currency.py`) tracks the household's foreign-currency holding. **The rule that drives the whole design: buying dollars is not an expense.** Net worth doesn't change, the money just moves between pockets. So an FX operation never enters `total_income`/`total_expenses`/`expenses_by_category` — but it does move real pesos, which is what `ars_available` on the dashboard reports.

Two different magnitudes are surfaced, deliberately kept apart:
- **Stock** (`holding`) — how many dollars are held right now. Carries across months, which is what makes "buy in August to pay September's card statement" work without distorting either month.
- **Flow** (`bought_usd`/`sold_usd`/`spent_usd`/`net_usd`) — what happened inside the selected month.

**The dashboard hero closes the month on both pockets, and `balance` is not allowed to be the headline.** Balance is pesos in minus pesos out; on a month where the household buys dollars and then pays a dollar card statement with them it reads as a large surplus while both pockets drain — the reference household's August 2026 shows `balance` $2.006.450 with $488.534 actually left and the 4.497 USD holding going to zero. So the hero leads with `ars_available` *and* the closing USD holding side by side, each with the chain that produced it, and demotes `balance` to a line of the peso chain. `month_summary` returns that dollar chain (`usd_holding_start`, `usd_initial`, `usd_bought`, `usd_sold`, `usd_earned`, `usd_paid`, `usd_adjustments`) as **differences between the cumulative `get_usd_holding` breakdowns at both ends of the month**, not as sums of the month's operations: both ends then share the holding's clamp at today, which is what makes `usd_holding_start + usd_initial + usd_bought + usd_earned − usd_sold − usd_paid + usd_adjustments == usd_holding` hold in the current month too. Don't swap them for `total_expenses_usd` — that's the whole month by cash-out date and legitimately differs from `usd_paid` mid-month. Every operation type needs its own term: `initial` was folded into the adjustments at first, and in the month the household declares its starting balance that printed the entire holding appearing out of nowhere under an "Ajustes" label. The frontend still prints any leftover as a final "Ajustes" row, now purely as a backstop for an operation type added later without a row of its own. The USD tiles that used to sit under the hero are gone on purpose: repeating the dollar figures as loose tiles is what let the peso number read as the month's result with the dollars as a footnote.

`foreign_amount` is **signed** (positive = currency in, negative = out) so the holding is a flat `SUM()` instead of a `CASE` per type, and an adjustment can go either way without a fifth op type. The sign is validated against `op_type` in `schemas/currency_operation.py` (`buy`/`initial` → positive, `sell` → negative, `adjustment` → either); `ars_amount` is required for `buy`/`sell` and **must be NULL** for `initial`/`adjustment` (those never moved pesos, so letting one through would corrupt `ars_available`). A partial unique index `uq_currency_op_initial` allows at most one `initial` per tenant+currency; `POST` returns 409 on a second one.

**A statement without a `due_date` is the normal case, not an edge case.** Statements are built up by hand during the month (there's no bulk import from the bank) and future ones are created outright by instalment propagation, so `due_date` is NULL for a large share of them — in the reference household, 38 statements holding 181 expenses. `cash_out_date()` must therefore fall back to `estimated_due_date()` *before* `expense_date`: falling straight through to the purchase date would silently restore purchase-date accounting for exactly the rows that need this most. The estimate is day `credit_cards.due_day` (seeded per card at migration from its most recent real due date, editable in the card form) of the month **after** the statement period — the month is never in doubt, only the day, and the day barely matters because everything aggregates monthly. `estimate_due_date_py()` mirrors the SQL for API responses; keep them in sync or `StatementOut.due_date_effective` will disagree with what the dashboard aggregates. `due_date_is_estimated` drives the "estimado" chip so an estimate never passes as fact, and loading the real date overrides it everywhere at once.

**Gross vs net, and why the holding stays gross.** Sharing a card item rewrites the creator's `ExpenseEntry.amount` down to their split while `CreditCardItem.amount` keeps the full charge (`credit_cards.py`, the `is_creator` branch). So expense entries are **net** (the household's own share) and card items are **gross** (what the bank debits) — in the reference household, 15.723 vs 21.729 USD all-time. Both matter, and they answer different questions:

- `holding` and `spent` are **net**, and the holding deliberately equals the real bank balance. The bank debits gross, but the other participants reimburse their share, and reimbursements are not recorded anywhere (deliberately — recording them would mean logging every incoming transfer). Gross out + reimbursement in ≈ net out, so subtracting net is what keeps the holding matching the account: `9940 − 11436 + 5938 = 4442 = 9940 − 5497`.
- `pending` is **gross** (`COALESCE(CreditCardItem.amount, ExpenseEntry.amount)`), split into `pending_own` / `pending_others`. On the due date the bank takes the whole statement whether or not participants have transferred yet, so "faltan U$D X" is a cash-**timing** warning, not a net-worth statement. Making pending net understated the real debit by more than half.

Don't "fix" this into a single number: the holding must keep matching the bank (that's what makes it checkable), and the commitment must keep showing the gross debit (that's what answers "¿me alcanza?").

**The MCP connector shares these rules, not just the code.** `expense_aggregate`, `income_aggregate` and `baseline_run_rate` all live in `analytics.py` precisely so the connector can't drift from the screen: expenses aggregate by cash-out date, income filters by currency (it must — since `IncomeEntry` gained one, summing without it adds dollars to pesos), and `statement_totals_by_period` / `committed_installments_by_period` are keyed by the **payment** month via `statement_due_date()`, not by the statement's own period. `compare_periods`' `currency` argument is wired through `_metric_for_month`; it used to be accepted and silently ignored, so a USD comparison returned peso figures. If you add an aggregation, put it here and use `cash_out_date()` — a tool that computes its own totals is how the assistant starts contradicting the dashboard.

**Outflows are counted on their cash-out date, not their purchase date — everywhere, both currencies.** `month_summary`, `expenses_by_category` and `history_series` all use `cash_out_date()`, so "Egresos de agosto" means pesos that left in August, not purchases made in August. This is what makes `ars_available` trustworthy; dating by purchase ran ~50% low on outflow for a card-heavy month and claimed pesos already committed to next month's statement. `IncomeEntry` has a `currency` column too, so `balance_usd` is a real flow (dollars in minus dollars out) alongside `usd_holding`, which is the stock. Argentine cards are paid a month in arrears, so a USD card purchase doesn't move dollars when you buy — it moves them when the statement comes due. `cash_out_date()` is `COALESCE(credit_card_statements.due_date, expense_entries.expense_date)`, reached through the outer joins in `_with_statement()`; a manual/cash USD expense keeps its own date. Dating by purchase was the original implementation and it was wrong: a July trip charged to a card showed as gone in July while the dollars were still sitting there until the August 7 statement. What's billed but not yet due is reported separately as `pending_usd` + `next_due_date` — those dollars are still held, and that number is precisely what the user needs to buy before the due date.

**The holding formula and its cutoffs** (`services/currency.get_usd_holding`):
```
holding = SUM(currency_operations.foreign_amount)
        − SUM(expense_entries WHERE currency='USD' AND cash_out_date >= fx_start_date)
```
Both sides are additionally capped at **today** (`as_of` is clamped): money that hasn't left yet isn't spent, so a future date would report a projection as a current balance. This is why the month tiles and the holding can legitimately disagree — browsing to August shows "Pagué U$D 5.497,92" (the statement due Aug 7) while the holding on Aug 5 still includes those dollars.
`fx_start_date` is the `operation_date` of the `initial` row (NULL → all USD expenses count). **This cutoff is load-bearing**: the DB already holds USD expenses predating the declared starting balance, and that declared number already reflects them — without the cutoff they'd be subtracted twice. USD expenses are picked up wherever they come from (manual, card items, accepted shared-expense splits), since they're all just `ExpenseEntry.currency == "USD"`.

**Valuation** reuses the `MacroVariable` USD columns already synced daily — no new API. `Tenant.fx_rate_type` (default `"blue"`) picks which; it's read via `get_tenant_rate_type()` with an explicit query rather than `user.tenant.fx_rate_type`, and exposed on `GET/PATCH /currency/settings` rather than folded into `UserOut` (whose tenant relationship is lazy — see the `selectinload` trap above). `"personalizado"` is valid per-operation but rejected as a household setting: no macro column backs it.

Note the asymmetry still present: outflows before `fx_start_date` are excluded, but `currency_operations` before it are not. A buy dated before the declared starting balance would be double-counted (those dollars are already inside the declared number). Not hit in practice yet — the fix is to apply the same cutoff to non-`initial` operations.

`services/currency.py` is also the single home for `RATE_TYPES` (re-exported from `schemas/shared_expense.py` for back-compat) and `get_or_create_usd_category()`, which used to be copy-pasted in `routers/expenses.py` and `routers/credit_cards.py`. The `backend/scripts/` importers keep their own copies on purpose — they're standalone.

### Shared expenses (Gastos compartidos)
`SharedExpense` has a `split_type` ("equal" or "custom") and links to `SharedExpenseSplit` rows (one per participant). Splits track `user_id` (nullable — may be an external guest), `member_name`, `amount`, and `status` ("pending"/"accepted"/"rejected").

**Invite flow**: when creating a shared expense with an external participant, the `invite_contact` field accepts either an email address or a phone number. Detection: `@` in value → email (generates `invite_token`, user copies link); digit string → phone (generates `invite_token` **and** sends a WhatsApp message via Evolution API using `EVOLUTION_API_URL`/`EVOLUTION_INSTANCE`/`EVOLUTION_API_KEY` env vars). The invite link is `{FRONTEND_URL}/invite/{token}` — set `FRONTEND_URL` in env for production. `GET /shared-expenses/invite/{token}` is a public endpoint (no auth). `POST /shared-expenses/invite/{token}/claim` assigns the split to the authenticated user, creates an `ExpenseEntry` in their tenant, and sets status to `"accepted"` in one step. Frontend stores the token in `localStorage("pendingInviteToken")` before redirecting to `/login`; `AuthContext.refreshUser()` auto-claims it after registration/join.

**Cross-tenant visibility**: `_load_q(user)` ORs three conditions — the expense belongs to your tenant, a split is already linked to your `user_id`, or **an unclaimed invite (`user_id IS NULL` + live `invite_token`) is addressed to your email or phone**. When a split is accepted, an `ExpenseEntry` is created in the acceptor's expense table.

**A pending invite must be visible in the app, not only in WhatsApp.** The third condition above is not a nicety: before it, an invite existed for the recipient *only* inside the WhatsApp link. Recipients who didn't click it had no way to see or accept the expense later, which is what produced the "nunca me llegó" reports — it did arrive. `_my_split(user, splits)` is the single matcher (own split first, then an unclaimed invite addressed to them) used by `_load_q`'s companion `_out()`, `accept` and `reject`, so accepting in-app does exactly what the link does, including sweeping every cuota of an installment plan. Rejecting calls `_consume_invite()` to kill the token — otherwise the link still works and silently re-accepts what the user just turned down. `_out(shared, user)` also strips `invite_token` from splits that are neither the viewer's own nor the creator's to hand out: a token alone claims the split it belongs to, and the expense is now visible to more people than before.

**Looking a participant up by phone/email must be fuzzy, because a miss is silent.** `_find_user_by_phone` matches `+549…` *and* `549…` (`_phone_lookup_values`), `_find_user_by_email` lowercases both sides. A failed lookup doesn't error — it downgrades the share into an invite token, so the recipient simply never sees the expense in their app. That was a real production bug: `/auth/me/verify-whatsapp` used to store the raw submitted phone, so half the users sat as `549…` while `_normalize_phone()` always produces `+549…`, and every share addressed to them by phone bypassed their account entirely. Migration `c9d0e1f2a3b4` converged the stored rows on `+digits`; keep both the migration and the tolerant lookups — the lookups are what stop it recurring if any other path ever writes a raw number.

**Phone number normalization**: when a phone number is entered for WhatsApp invite, it's normalized to international format (`+54934567890`) via `_normalize_phone()` in the backend. The frontend uses `normalizePhoneNumber()` from `lib/utils.ts` to parse device contact picker results and split them into `prefix` (country code like "54") and `local` (number without prefix). The frontend's `buildPhone()` function reconstructs the format expected by the backend: for Argentina, adds "9" after the prefix (`549...`). Always normalize before sending to backend or Evolution API.

**Sharing a cuota plan (`POST /credit-cards/items/{id}/share`)**: creates one `SharedExpense` per cuota (root + children), but only the root mints an invite token and sends the WhatsApp — one message per plan, not per cuota. Each cuota's `payment_date` is its statement's `due_date`, falling back to `estimate_due_date_py(year, month, card.due_day)` — **not** to the cuota's `item_date`. The two are not interchangeable: `item_date` counts months from the purchase while the statement counts from the period the purchase landed in, so for a plan bought late in a period the item_date fallback put every cuota months early (in the reference data, two). `payment_date` is what the "Compartidos → persona → mes" view buckets by, so the error moved cuotas into the wrong month for both sides.

**Deleting an installment (cuota) group**: `DELETE /shared-expenses/{id}` auto-detects group membership via `_find_group_shared_ids` (root + siblings sharing `installment_group_id`). For a single (non-grouped) expense the delete is unconditional, same as always. For a group, it only deletes cuotas with `expense_date >= today` (via `_find_future_group_shared_ids`) — past cuotas, and the `CreditCardStatement` rows themselves, are never touched, even if that leaves an empty statement. Each deleted cuota also removes its linked `CreditCardItem` and both sides' `ExpenseEntry` rows (the creator's own entry is shared between the split and the `CreditCardItem`, so entry ids are deduped before deleting to avoid a double-delete). Returns `400` if every cuota in the group is already in the past (nothing to delete) rather than silently no-op'ing. The frontend un-hides the delete button on grouped cards in `shared/page.tsx` and shows a distinct confirm message for the group case.

### Contacts (household agenda)
`TenantContact` (`routers/contacts.py`) is a **household-wide** address book — unique per `tenant_id + contact_phone`, not per user. It starts empty and auto-populates: `_save_tenant_contact()` in `shared_expenses.py` is called from both the shared-expenses and credit-cards phone-invite branches every time someone invites an external contact by phone, silently skipping if that phone is already saved (even under a different name). `GET /contacts` is used by the shared-expenses form and the credit-card "compartir ítem" modal to offer a "Elegir de la agenda" dropdown when adding an external participant — this is the primary way to pick a known contact on iOS, since the native Contact Picker API isn't usable there (see Device APIs below). There's no dedicated ABM screen yet.

### Calendario de pagos (payment reminders)
`PaymentReminder` (`routers/reminders.py`) is a **household-wide** freeform reminder: `title` + `remind_date`, optionally linked to a `statement_id` (`SET NULL` on delete). `GET /reminders?year=&month=` / `POST /reminders` / `DELETE /reminders/{id}` are the CRUD; any member of the tenant can see/delete any reminder, but `user_id` (the creator) is who gets notified. The `/calendario` frontend page renders a month grid combining `GET /credit-cards/statements/calendar` (closing/due dates, orange/red dots) with `GET /reminders` (violet dots) built with `date-fns` — no calendar UI library is used, just `startOfWeek`/`eachDayOfInterval`/etc. Clicking a day opens a panel to add a reminder for that date.

**The day's events are on screen, not behind a click.** The grid's dots say *that* something happens on a day; `DayDetail` under the calendar says what. It opens on **today** — the day the user came to check — and follows whatever day they click, with the selection drawn as `border-ink bg-accent` so it wins over today's `border-primary` (today is where you start, the selection is where you're looking). Changing month re-points it at today when today belongs to the new month and at its 1st otherwise, so the panel never describes a day that isn't on screen.

`send_due_reminders()` (called by the `_daily_reminder_check` scheduled job) WhatsApps each reminder due today to its creator via `_send_wa_msg`, then marks it `notified=True` regardless of send outcome (fire-once semantics — failures are logged, not retried). **Only works if that specific user has linked their own WhatsApp number** (`user.whatsapp_phone`) via `/auth/me/link-whatsapp` in Settings; otherwise the reminder still shows on the calendar but silently skips the WhatsApp.

### Internal diagnostics
`routers/internal_logs.py` exposes `/internal/*` endpoints gated by a shared-secret header (`x-internal-key` must match the `INTERNAL_LOG_KEY` env var), not user auth — used for ops/debugging, never called from the frontend:
- `GET /internal/logs`, `GET /internal/logs/summary`, `POST /internal/logs/frontend-error` — read/write `AppLog` rows.
- `GET /internal/pending-shared-invites` — diagnostic listing of `SharedExpenseSplit` rows (optionally filtered by `creator_email`) to distinguish already-registered recipients (visible in-app, `user_id` set) from external invites still waiting on `invite_token`.
- `POST /internal/backfill-shared-invite-claims` — one-off data-repair tool that replicates `POST /shared-expenses/invite/{token}/claim` (assign `user_id`, create the `ExpenseEntry`, mark `accepted`) keyed by `{split_id, user_id}` pairs instead of a token, for manually linking splits whose invite never got delivered.
- `GET /internal/tenant-contacts` / `DELETE /internal/tenant-contacts/{id}` — read and clean up the household agenda (`TenantContact`) directly, e.g. to remove stale/duplicate entries.
- `GET /internal/whatsapp-check?phone=` — calls Evolution's own `/chat/whatsappNumbers/{instance}` lookup (no message sent) for a phone in several plausible AR formats (with/without the leading 9, bare local). Useful because Evolution's dedicated lookup and its `/message/sendText` endpoint's internal existence check don't always agree — see Phone number handling below.
- `POST /internal/resend-shared-invite/{split_id}` — re-sends the original WhatsApp invite for a split whose `invite_token` was already minted but never delivered (e.g. Evolution API was down at the time); reuses the existing token rather than minting a new one, so a link the recipient may have already opened keeps working.
- `GET /internal/credit-card-item-raw/{shared_expense_id}` — dumps the raw `CreditCardItem` behind a shared installment expense (`amount` per cuota, `purchase_total`, sibling cuotas) to tell apart a genuine per-cuota amount from a user data-entry mistake (typing the total into "monto por cuota" or vice versa).

The root `mcp/server.py` (a FastMCP stdio server registered in `.mcp.json` as `registrapp-logs`) wraps the `/internal/logs*` endpoints as Claude Code tools (`recent_errors`, `search_logs`, `logs_by_module`, `log_summary`), authenticating with `MCP_INTERNAL_KEY` against the same `INTERNAL_LOG_KEY`. It only covers the log endpoints — the other `/internal/*` diagnostics above are called directly with `curl` + the same key. **It is an ops tool and has nothing to do with the user-facing MCP connector below** — different server, different auth, different audience.

### Conector MCP (`/mcp`) — la app como fuente de datos para una IA
End users connect their household to Claude (web, Desktop, Code) and ask about their own finances. **Read-only by design: no tool in `backend/app/mcp_server/` writes anything.** Scope is the whole household (`tenant_id`), like the rest of the app.

**Transport** (`app/mcp_server/instance.py` + `transport.py`): a stateless `FastMCP` served at the exact route `/mcp`, `mcp==1.29.0` pinned (later releases rename `FastMCP` → `MCPServer` and change `streamable_http_app()`'s signature). Three things break it if touched:
- It's registered as `Route("/mcp", endpoint=<asgi app>)`, **not** `app.mount("/mcp", ...)` — mounting answers `POST /mcp` with a 307 to `/mcp/`, which gives the RFC 8707 canonical resource two spellings.
- The lifespan in `main.py` wraps its `yield` in `async with mcp.session_manager.run()`. A mounted sub-app's lifespan never runs and without this the first request dies with `RuntimeError: Task group is not initialized` — including in stateless mode. It can only be entered once per process (fine: uvicorn runs a single worker).
- `transport_security=` is mandatory. With the default `host="127.0.0.1"`, FastMCP builds its own anti-DNS-rebinding settings that only allow localhost, so behind Traefik **every production request returns a bare 421** before auth even runs. That's the first thing to check if "it works locally but not in prod".

`mcp` pulls in starlette and sse-starlette; both are pinned (`starlette==0.41.3`, `sse-starlette==2.1.3`) because the unconstrained resolve installs starlette 1.x, which breaks FastAPI 0.115 (`Router.__init__() got an unexpected keyword argument 'on_startup'`) and takes down every router in the app.

**Auth** — two credential types, one table (`mcp_tokens`, `kind` = `pat` | `oauth_access` | `oauth_refresh`), only sha256 hashes stored, readable prefixes `rap_pat_` / `rap_at_` / `rap_rt_`:
- **PATs**, created in Settings, for clients that send their own header (`claude mcp add --transport http registrapp https://…/mcp --header "Authorization: Bearer rap_pat_…"`).
- **OAuth 2.1**, for claude.ai / Claude Desktop custom connectors, which accept nothing else. `services/oauth_provider.py` implements the SDK's `OAuthAuthorizationServerProvider`; the SDK's own handlers (registration, authorize, token, revoke) are wired in `routers/oauth.py` under `/oauth/*`, with the RFC 9728 / RFC 8414 discovery documents at the domain root. The metadata is hand-built as plain dicts because the SDK's `OAuthMetadata` model has no `authorization_response_iss_parameter_supported`, which Claude looks for.

The login is delegated: `authorize()` doesn't render anything, it stores a consent transaction and redirects to `{FRONTEND_URL}/oauth/authorize?txn=…`. That page (`frontend/app/oauth/authorize/page.tsx`, deliberately **outside** the `(app)` group — that layout would bounce a logged-out visitor to `/login` and lose the `?txn=`) signs the user in with Google and calls `POST /oauth/authorize/consent`, which mints the code and returns the redirect URI including `iss` (RFC 9207).

What the SDK does *not* do and lives in our code: validating the `resource` indicator (enforced three times — `authorize`, code exchange, and `verify_token` — it's the confused-deputy defence), emitting `iss`, and adding `scope=` to the `WWW-Authenticate` challenge. Refresh tokens rotate on every use and a replayed one revokes the entire `grant_id` (`reuse_detected`). `grant_id` is also what makes "Desconectar" in Settings kill access + refresh + every rotation in one UPDATE.

`_daily_mcp_cleanup` (09:03 UTC) drops expired codes/transactions, tokens revoked or expired over 30 days ago, and dynamically registered clients with nothing left pointing at them.

**Two traps in `main.py` that are easy to undo:**
- `mcp_cors_middleware` handles CORS for `/mcp`, `/oauth/*` and `/.well-known/*` separately, because the global `CORSMiddleware` sends `allow_credentials=True` and a browser refuses to pair that with `*` — while claude.ai probes discovery from arbitrary origins with no cookies. This is why `ALLOWED_ORIGINS` does **not** need `claude.ai` added.
- `_is_expected_auth_noise` keeps `AppLog` from filling up: an unauthenticated 401 on `/mcp` **is** the normal first step of OAuth discovery, so every client that connects would otherwise log one.

**Tools** (`app/mcp_server/tools_*.py`, all read-only, built on `services/analytics.py`): `get_taxonomy`, `get_month_summary`, `list_expenses`, `list_income`, `compare_periods`, `get_series`, `get_upcoming_commitments`, `get_budget_baseline`, `simulate_purchase`, `get_usd_position`, `get_macro`. Plus two resources (`registrapp://schema`, `registrapp://taxonomy`) and three prompts (`analisis_mensual`, `armar_presupuesto`, `evaluar_compra`).

Two rules the tools encode and that any new tool must respect:
- **Aggregate by default.** `list_expenses` groups by category unless asked otherwise (~1 KB instead of ~28 KB of raw rows). `serialize.guard()` is the backstop: past ~48 KB it drops detail arrays, keeps the aggregates, and explains how to re-query. Amounts serialize as `float`, never `Decimal` (which produces an `anyOf: [number, string]` output schema and a stringified value).
- **Never double-count instalments.** Every `CreditCardItem` mirrors into `expense_entries` dated at the *purchase*, so all 12 cuotas of a plan land in one past month. `analytics.baseline_run_rate` therefore excludes instalment- and mortgage-mirrored entries from the monthly average, and `simulate_purchase` adds them back per month as explicit commitments. Averaging them *and* adding future commitments inflates the projection badly.

`compare_periods` and `get_series(deflate=...)` exist because nominal comparisons are misleading here: they report `delta_real_pct` against a chained CPI index built from `macro_variables.inflation_monthly_pct`, flagging months INDEC hasn't published yet as `estimated` instead of inventing a number.

### Frontend structure
```
frontend/app/
  (auth)/login/     # Google sign-in page
  onboarding/       # First-time tenant creation
  (app)/            # Protected layout (sidebar + auth guard)
    dashboard/      # Summary hero (how the month closed, both currencies) + stat tiles +
                    #   pie charts (categories, income sources, USD by description) — the
                    #   charts are always the current calendar month, independent of the
                    #   month selector the hero and tiles follow
    income/         # Income entries with bruto/deducciones/neto; search + filters, entry and
                    #   source forms in modals, "+" FAB, bulk import behind the header's ⋮
    expenses/       # Expense entries; search + filters, entry and category forms in modals,
                    #   "+" FAB; credit card entries show badge + "Ver en resumen" only
    divisas/        # USD holding (summary hero) + monthly buy/sell/spend flow + operations
                    #   list; operation form in a modal, "+" FAB, opening balance behind the ⋮
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
  lib/countries.ts            # Shared COUNTRIES list (flag/prefix/placeholder) for phone inputs —
                              #   used by settings, shared, and WhatsAppVerifyForm
  components/WhatsAppVerifyForm.tsx  # Phone OTP send/verify UI, shared by Settings (WhatsAppSection)
                              #   and the onboarding gate — takes `onVerified` and an optional
                              #   `onSkip` (only wired up in onboarding, to render the escape hatch)
  components/ProductTour.tsx  # react-joyride wrapper; tracks "seen" per tourId in localStorage
                              #   (never in the backend), takes a `requireDesktop` flag for tours
                              #   whose targets only exist in the desktop Sidebar (hidden on mobile)
  components/ui/              # The shared kit every screen builds from — see the sections
    summary-card.tsx          #   below for the rules each one encodes:
    filters.tsx               #   hero summary / filter+search bar / form fields /
    form.tsx                  #   listbox machinery / the one calendar / floating "+".
    listbox.tsx               #   Adding a screen means composing these, not restyling
    calendar.tsx              #   `<select>`, `<input type="date">` or a bare grid again.
    fab.tsx
    card.tsx, button.tsx, chip.tsx
```

**Hiding amounts is a module flag, not a prop.** "Ocultar montos" (the ⋮ menu on dashboard, ingresos and egresos) masks every peso and dollar figure in the app as `••••`. The flag lives in `lib/utils` so `formatARS`/`formatUSD` mask without their ~90 call sites knowing — threading a prop through all of them and hoping none is ever missed is how one amount stays on screen and defeats the feature. `PrivacyProvider` (in the `(app)` layout) owns the state, persists it, and writes the flag **during render**, before its children run.

That is not enough on its own, and the trap is worth knowing: the pages arrive as the provider's `children` prop, so their element identity doesn't change when the provider's state does, and React skips re-rendering them — the flag flips and the painted numbers stay. **Every screen that renders money calls `useAmountsHidden()`**, which subscribes it to the context and gets it repainted. If a new screen shows amounts and forgets that line, its numbers won't hide.

Anything that formats money outside `formatARS`/`formatUSD` has to check `areAmountsHidden()` itself — that's how the dashboard donut's centre total is covered. Public data (a market rate chip in `/macro`) is not masked.

**The summary hero always uses `components/ui/summary-card.tsx` — never a new shape.** The one `variant="hero"` card at the top of a screen (dashboard, `/divisas`) answers "where do I stand" and always reads as the same three bands:

```tsx
<SummaryCard>
  <SummaryHeader title="Cierre de agosto 2026" open={showDetail} onToggle={…} />
  <SummarySection label="Estado actual" />
  <SummaryGrid cols={2}>
    <SummaryCell figure className="order-1 sm:order-none"><SummaryFigure value={…} sub={…} trend={…} /></SummaryCell>
    <SummaryCell figure href="/divisas" className="order-3 sm:order-none border-t sm:border-t-0 sm:border-l border-border/60">…</SummaryCell>
    {showDetail && <>
      <SummaryCell className="order-2 sm:order-none border-t border-border/60"><ChainRow label="Ingresos" sign="+" value={…} /> …</SummaryCell>
      <SummaryCell className="order-4 sm:order-none border-t sm:border-l border-border/60">…</SummaryCell>
    </>}
  </SummaryGrid>
  {showDetail && <SummaryTotal items={[arsTotal, usdTotal]} />}
</SummaryCard>
```

Every rule in it was a correction, so don't undo one without knowing which:
- **Columns are equal width, never content-sized.** A peso figure is three times as wide as a dollar one; sizing to content turns two equally important numbers into a headline and a footnote.
- **Rows are *not* forced to match each other.** `auto-rows-fr` across the grid stretches the figures row to the height of the taller chain row and leaves a band of dead space under the numbers.
- **The detail starts collapsed** behind `Ver detalle`. The figures are the answer; the chain is the arithmetic.
- **Signs ride on the amount, never on the label** (`−$ 1.517.916,00`). A `−`/`=` hanging to the left of the label starts every row at a different x.
- **The chains close on one shared `SummaryTotal` strip**, not a bold row each — a total per column restates the big figure directly above it.
- **The category bars grow from their left edge**, staggered 60ms per row so the list fills top to bottom instead of every bar snapping at once. They animate `scaleX`, not `width`: the target width is a percentage computed per row, and one keyframe can't know it.
- **A Recharts pie won't animate on mount inside a `ResponsiveContainer`.** The mount animation runs on the first render, which is the one where the container still measures 0×0, so it plays out invisibly and the donut just appears finished. `DonutChartCard` feeds it `data={ready ? data : []}` one frame later, once the container has a size — that data change is what makes the sweep visible. Setting `isAnimationActive`/`animationDuration` alone does nothing.
- **Only the dashboard's two figures count up** (`SummaryFigure` takes `amount` + `format` instead of a pre-formatted `value`, and `useCountUp` animates from what's on screen to the target — 0 on mount, the previous month's figure when the month changes). It's the screen's headline; animating every figure in the app turns a flourish into noise. It no-ops under `prefers-reduced-motion`, and the figure carries `tabular-nums` so the digits don't dance while it runs.
- **Every chain lists movements**, never an already-consolidated subtotal. The peso chain used to open on "Balance del mes" while the dollar one listed its parts, and that reads as an inconsistency even though the accounting justifies it (buying dollars isn't income).
- On mobile the grid stacks to one column and `order-*` keeps each chain directly under the figure it explains.

Note the asymmetry the format can't hide and shouldn't: the dollar column opens on a **stock** ("Tengo al inicio") because the holding carries across months, while the peso column can only report the month's **flow** — the app never records a peso account balance. Closing that gap would mean letting the user declare an opening peso balance the way they declare `initial` for dollars.

**Form fields come from `components/ui/form.tsx`, and the calendar from `components/ui/calendar.tsx`.** A form built out of bare `<input>`/`<select>` looks like an unstyled page next to the rest of the app, whose signature is a 2px ink border (`FIELD` carries it). Two native controls in particular have to go:
- `<select>` renders its option list as an OS menu, and that list is the part CSS can't reach — styling the closed box still leaves a grey system dropdown landing on top of the app. `SelectField` is a **listbox**: a button plus our own portalled panel, taking `options={[{value,label}]}` and `onChange(value)` (not a DOM event). It keeps the placeholder grey while the value is empty, marks the selection with a check, and handles ↑/↓/Enter/Escape — replacing a native control can't cost the keyboard.
- `<input type="date">` shows `mm/dd/yyyy` and a browser calendar that looks nothing like the one in the filter bar. `DateField` opens the same `CalendarPanel` the range picker uses — one calendar in the app, one gesture to pick a date. `<input type="month">` is the same story with `mm/yyyy`: `MonthField` replaces it with a year stepper over a 12-month grid, and its value stays `yyyy-MM`, which is what the endpoints taking a period already expect.
- `<input type="number">` draws OS spinner arrows and, on mobile, fights the keyboard. Use `type="text" inputMode="numeric" pattern="[0-9]*"` for integers (and `parseAmount` + `inputMode="decimal"` for money — see "Amount fields").

`calendar.tsx` is the single implementation (`CalendarPanel` + its month grid, hand-built on date-fns like `/calendario`'s — the project has no calendar library and doesn't need one). `from`/`to` drive the painting for both callers: a range highlights the band between them, a single date is just `from === to`.

Placement rules that were bugs first — the panel has to clear a modal that both scrolls and stacks:
- It is **portalled to `document.body` and positioned `fixed`**. In the flow it pushed the form around; absolute inside the modal it was clipped by `overflow-y-auto`. Out of the tree it floats above everything without a z-index race.
- It **anchors to its field's right edge and flips above** when there's no room below, clamped to the viewport. These fields sit in two-column grids, so a panel wider than its column has to overflow towards the middle of the modal, not off its edge.
- Position is measured after render (the height changes with how many weeks the month spans) and recomputed on resize and on **capture-phase** scroll — the scroll that moves the field is the modal's, and it doesn't bubble.

**Fields keep their width; the text truncates.** Grid and flex items default to `min-width: auto`, so the longest option in a combo out-votes `w-full` and stretches the field — and the whole column with it, which knocks the two-column form out of alignment. Reproduced with a real source name: the combo went from 189px to 372px and pushed the date field off its column. The floor is set in three places so no caller has to remember it: `FIELD` carries `min-w-0`, `Listbox`/`DateField` wrap themselves in it, and `FormGrid` (the two-column layout a form modal uses) applies `[&>*]:min-w-0` to every cell. Use `FormGrid` rather than hand-rolling `grid grid-cols-1 sm:grid-cols-2`.

**Label copy**, which is part of the format and not decoration:
- The label is the **short noun** — `Bruto`, `Deducciones`, `Neto`, not `Sueldo bruto`. The form already says what it is (its title, the screen it's on); repeating that in every label is noise, and it stops being true the moment the same form takes a non-salary income.
- **No currency in the label.** `Sueldo bruto ($)` was wrong outright: this form has an ARS/USD toggle at the top, so the hardcoded `$` contradicted the field as soon as the user picked dollars. Currency belongs to the toggle, or to the formatter that renders the value.
- **`(opcional)`, lowercase, only where it's true.** Marking a required field optional is a lie; leaving a genuinely optional one unmarked makes every field look mandatory. In the income form `Bruto` and `Deducciones` carry it and `Neto` doesn't — it's the amount actually stored, the other two only feed its automatic calculation.

A form field defaults to **today**, already selected and ringed in the grid: it's the overwhelmingly common answer, and it saves a trip through the calendar to pick the date you're standing on.

`DateField` also renders a hidden `required` input: the visible control is a button, so without it the browser's own validation would let the form submit with no date.

**Filters and search always use `components/ui/filters.tsx` — never a new shape.** Every list screen that gains searching, sorting or filtering renders the same bar, the one `/tarjetas` established:

```tsx
<FilterBar>
  <FilterRow>
    <CollapsibleSearch open={searchOpen} onOpen={…} onClose={() => { setSearch(""); setSearchOpen(false); }}
                       value={search} onChange={setSearch} placeholder="Buscar por …" />
    {!searchOpen && (
      <>
        <SortChip label="Fecha" active={sort === "date"} dir={order} onClick={() => toggleSort("date")} />
        <FilterChip label="Personalizado" icon={SlidersHorizontal} active={panelActive}
                    onClick={() => setShowPanel(v => !v)} />
      </>
    )}
  </FilterRow>
  {showPanel && !searchOpen && (
    <FilterPanel>
      <PillSelect …>…</PillSelect>
      <PillDateRange from={dateFrom} to={dateTo} onChange={(f, t) => {…}} />
      {panelActive && <ClearFilters onClick={…} />}
    </FilterPanel>
  )}
</FilterBar>
```

The rules that make it that bar and not another one:
- **Not inside a `<Card>`.** It sits bare above the list. Boxing it turns a control strip into a second panel competing with the content — that's what the first version of the income filters did, and it read as a different app.
- **Search starts collapsed**, as a magnifier that expands in place into an underlined input, and the chips hide while it's open. Closing it clears the term.
- **Sorting is tri-state**: inactive → asc → desc → inactive. "Inactive" means the list's natural default, so a screen backed by a sorted endpoint sends its default (e.g. income: `sort=date&order=desc`) when no chip is lit.
- **Everything beyond one search box and the sort chips goes behind "Personalizado"**, in the second row, as `PillSelect`/`PillDateRange`. `ClearFilters` shows only while something in the panel is set.
- **A `PillSelect`'s empty option is the field's name** — `Categoría`, `Fuente`, `Titular`, `Moneda` — not `Todas las categorías`. There is no label above the pill, so that option *is* the label, it's on screen far more often unset than set, and four pills reading "Todos los…/Todas las…" say nothing about which is which at a glance. It renders in `text-muted-foreground` while unset and `text-foreground` once a value is picked, so a set filter is visible without reading it.
- **A period is one control, not two.** `PillDateRange` is a single pill that opens the shared `CalendarPanel` and works the way a flight search does: first click sets the start, second sets the end, the days between fill in as the pointer moves, clicking backwards swaps the ends. One month, like every other calendar in the app — a second month made this one picker look like a different component. Two `type="date"` inputs make the user think in "desde"/"hasta" fields; this lets them think in periods.
- **`PillSelect` is the same `Listbox` as the form's `SelectField`**, wearing the pill instead of the field. Everything about a dropdown that reads as "genérico" is the OS option list, and that's the part CSS can't restyle, so no screen in the app is allowed to fall back to a bare `<select>`.
- Screens differ in *where the filtering happens*, and that's fine: `/tarjetas` and a card statement's items (`/tarjetas/[cardId]/[statementId]`) filter client-side over an already-loaded list, while income and expenses filter server-side (`GET /income/entries`, `GET /expenses/entries`) because they have to reach months that aren't loaded. Same bar either way.
- **A client-side screen still folds accents**, via `foldText()` in `lib/utils.ts` — the mirror of `services/search.fold()`. Without it the same term finds a row in `/egresos` and misses it inside the resumen that row came from.
- **A pill only offers values the loaded list actually contains.** The statement page derives its Categoría/Tipo/Moneda options from its own items and drops the Tipo and Moneda pills entirely when the statement has only one of each — an option that matches nothing reads as "no hay nada" when it means "no existe", and two dead pills is most statements.
- **When a filter narrows a list whose total is a fact about the world, the total has to say so.** A resumen's "Total" is what the bank debits, so the footer switches to `Total filtrado (2 de 9)` and prints `Total del resumen: …` underneath while anything is filtered. The breakdown card ("Por categoría") follows the same filtered set — a summary that disagrees with the rows above it reads as a bug.

**The two server-side search endpoints share their matching rules, not just their shape.** `services/search.py` holds `fold()`/`fold_term()` — accent- and case-insensitive `LIKE` via `translate()` on both sides — so a term that finds "Inversión" typed as `inversion` finds it on every screen. Two things they both encode:
- **The search box matches every field the row displays.** Income: source name + notes. Expenses: description, category name, `entity` (the card alias on a card charge) and notes. A row that surfaces for a reason the user can't see on it reads as a bug, which is why both pages render the matched secondary field (notes / category) under the title *only while filtering*.
- **Sorting by amount orders by `(currency, amount)`, never by amount alone.** Both lists mix ARS and USD rows, and interleaving them would put U$D 500 next to $500 — the one thing the app's domain rules say never to do. Each currency ends up in its own block, sorted within itself.

**A status `<Chip>` in a card header pins to the right edge of the header row — `ml-auto`, never trailing the title.** A single chip qualifying the whole card (`Próximo vencimiento: 10 sep`, `Vencido`, `Solo lectura`) belongs on the title's line, pushed to the card's right margin, so the header reads as one band with the name on the left and its state on the right:

```tsx
<Card className="p-4 md:p-5 space-y-4">
  <div className="flex items-center gap-2">
    <Home className="w-4 h-4 text-primary shrink-0" />
    <h3 className="font-semibold text-foreground text-sm md:text-base truncate">Hipoteca</h3>
    <Chip tone="neutral" className="ml-auto shrink-0">Próximo vencimiento: 10 sep</Chip>
  </div>
  …
</Card>
```

What this replaced, and why it isn't just a nicety: the chip sat directly after the `<h3>` in a `flex items-center gap-2 flex-wrap`, so its x was set by the length of the title next to it — nothing in the card lined up with it, and it landed in the middle of the header with dead space to its right. `ml-auto` is what makes the right edge the anchor instead.

Two classes it carries and shouldn't lose: `shrink-0` on the chip (it's `whitespace-nowrap`, so without it a tight card compresses the pill instead of the prose) and `truncate` on the `<h3>` (that's what absorbs the squeeze — the title can lose characters, the state can't).

A **row of several chips** describing the card's attributes is the other case, and it does get its own row under the header, flush left, as `/mortgage`'s loan card does it ([`flex flex-wrap gap-1.5`](frontend/app/(app)/mortgage/page.tsx) with `Tipo`, `36 cuotas`, `desde …`, `TNA …`). The split is by role, not by count: one chip that says *what state this is in* goes right on the header; a set that says *what this is made of* goes below it.

Two placements neither rule covers: a chip acting as a list row's right-hand metadata (the role chip in Settings' member list) is already right-aligned by its row's own layout, and a chip set inline in a sentence (`<Chip className="ml-2 align-middle">` in `/invite`) is running text, not a header.

**Device APIs (PWA-specific)**: The app uses the Web Contact Picker API (`navigator.contacts.select()`) to let users pick contacts from their device. **In practice this only works on Chrome/Edge for Android — Safari on iOS does not support it**, even in "Add to Home Screen" standalone mode, unless the user manually enables an experimental flag (unrealistic for real users). Always wrap contact picker calls in try-catch, check `"contacts" in navigator` before calling, and give the user visible feedback (not a silent no-op) when unsupported — the household agenda (`TenantContact`, see above) is the practical fallback for iOS. When picking contacts, normalize the phone number result via `normalizePhoneNumber()` before using.

`AuthContext` exposes `firebaseUser`, `appUser`, `loading`, and `refreshUser()`. `refreshUser()` re-fetches `GET /auth/me` **and then auto-claims any `pendingInviteToken` stored in localStorage** — call it after register/join to complete the invite flow. The `(app)` layout redirects to `/login` if not authenticated, or `/onboarding` if authenticated but no `appUser` (tenant not created yet) **or `appUser.whatsapp_gate_pending` is still `true`** (see the onboarding gate above).

**Product tour**: `ProductTour` is mounted per-page (`dashboard`, `income`, `expenses`), each with its own `tourId` and step list targeting `data-tour="..."` attributes (e.g. on `Sidebar` nav links, or the "+ Agregar"/"Importar" buttons). A tour that targets Sidebar links must pass `requireDesktop` — those links live in the `hidden md:flex` desktop `<aside>`, so on mobile Joyride can't find the target and would otherwise mark the tour "seen" without ever showing it. "Reiniciar guía" in Settings clears every known `tourId`'s localStorage key via `resetAllTours`.

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
Import `FIELD`, `FormGrid`, `SelectField` and `DateField` from `components/ui/form.tsx` — don't declare a per-page `INPUT` constant, and don't reach for a bare `<select>` or `<input type="date">`. As of 2026-08-13 there are **zero** of either left under `app/(app)/`, so a new one stands out as the odd screen rather than as one more of many. The rules and the reasons are in the frontend section above; the short version is that the two native controls render an OS widget for the part CSS can't restyle, and that a field with no `min-w-0` stretches its whole column to fit its longest option.

### Amount fields
Use `type="text" inputMode="decimal" pattern="[0-9.,]*"` instead of `type="number"` for currency inputs. `type="number"` causes UX issues on mobile and with large Argentine peso values.

When reading user-entered amounts, always use `parseAmount(value)` from `lib/utils.ts` — never `parseFloat(value)` directly. `parseFloat("9,99")` returns `9` in JavaScript (stops at comma). `parseAmount` normalizes Argentine format first: removes thousands dots, replaces decimal comma with dot, then calls `parseFloat`.

### Phone number handling
Phone numbers are stored in international format (+54934567890) but entered via user input, device contacts, or WhatsApp messages. Always normalize before database operations:
- **Frontend**: Use `normalizePhoneNumber(rawInput)` from `lib/utils.ts` to parse unstructured input. Returns `{prefix, local, isValid}`.
- **Backend**: Use `_normalize_phone(value)` from `routers/shared_expenses.py` to normalize before storing/comparing. It always inserts the mandatory `9` after the `54` country code for Argentine numbers (even for a bare 10-digit local input) — don't reintroduce a code path that only *preserves* a `9` the caller already included, that silently produces invalid JIDs for the common case of a freshly-typed number.
- **Evolution API**: Expects full international format like `+54934567890`.
- **User lookups**: never compare `user.whatsapp_phone` with `==`. Go through `_find_user_by_phone()`, which tries every spelling `_phone_lookup_values()` returns (`+549…` and `549…`). `/auth/me/verify-whatsapp` now normalizes on write and migration `c9d0e1f2a3b4` fixed the rows that predate that, but the tolerant lookup is the actual safeguard — an exact-match miss fails silently and costs the user in-app visibility of whatever was shared with them (see Shared expenses above).
- **Sending is a two-step resolve-then-send, not a direct `sendText` call**: Evolution API's `/message/sendText/{instance}` endpoint has its own internal number-existence check that is stricter (and inconsistent) with its dedicated `/chat/whatsappNumbers/{instance}` lookup endpoint — a number the lookup confirms `exists: true` can still get rejected by `sendText` with `exists: false` for the exact same string. `_resolve_whatsapp_jid()` in `shared_expenses.py` calls the lookup endpoint first and sends to whatever canonical number it returns (falling back to the locally-normalized number only if the lookup itself fails); both `_send_wa_msg` and `/auth/me/link-whatsapp` go through it. Diagnose future "WhatsApp doesn't arrive" reports with `GET /internal/whatsapp-check?phone=` before assuming it's a formatting bug.
