from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from decimal import Decimal
from datetime import date

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.income import IncomeEntry
from app.models.expense import ExpenseEntry, ExpenseCategory
from app.models.macro_variable import MacroVariable
from app.models.mortgage import MortgageRecord
from pydantic import BaseModel

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class CategorySummary(BaseModel):
    category_name: str
    total: Decimal
    color: str | None = None


class MonthSummary(BaseModel):
    period: str
    total_income: Decimal
    total_expenses: Decimal
    balance: Decimal
    mortgage_payment: Decimal | None
    uva_value: Decimal | None
    inflation_pct: Decimal | None
    expenses_by_category: list[CategorySummary]


class HistoryPoint(BaseModel):
    period: str
    total_income: Decimal
    total_expenses: Decimal
    mortgage_payment: Decimal | None
    uva_value: Decimal | None
    inflation_pct: Decimal | None


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


@router.get("/summary/{year}/{month}", response_model=MonthSummary)
async def monthly_summary(
    year: int,
    month: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    tid = user.tenant_id
    start = date(year, month, 1)
    end = date(year, month + 1, 1) if month < 12 else date(year + 1, 1, 1)

    total_income = await db.scalar(
        select(func.coalesce(func.sum(IncomeEntry.amount), 0))
        .where(IncomeEntry.tenant_id == tid, IncomeEntry.period_date >= start, IncomeEntry.period_date < end)
    )

    total_expenses = await db.scalar(
        select(func.coalesce(func.sum(ExpenseEntry.amount), 0))
        .where(ExpenseEntry.tenant_id == tid, ExpenseEntry.expense_date >= start, ExpenseEntry.expense_date < end)
    )

    rows = await db.execute(
        select(ExpenseCategory.name, ExpenseCategory.color, func.sum(ExpenseEntry.amount).label("total"))
        .join(ExpenseEntry, ExpenseEntry.category_id == ExpenseCategory.id)
        .where(ExpenseEntry.tenant_id == tid, ExpenseEntry.expense_date >= start, ExpenseEntry.expense_date < end)
        .group_by(ExpenseCategory.name, ExpenseCategory.color)
        .order_by(func.sum(ExpenseEntry.amount).desc())
    )
    by_category = [
        CategorySummary(category_name=r.name, total=r.total, color=r.color)
        for r in rows
    ]

    mortgage = await db.scalar(
        select(MortgageRecord).where(
            MortgageRecord.tenant_id == tid,
            MortgageRecord.period_date >= start,
            MortgageRecord.period_date < end,
        )
    )

    macro = await db.scalar(
        select(MacroVariable).where(
            MacroVariable.tenant_id == tid,
            MacroVariable.period_date >= start,
            MacroVariable.period_date < end,
        )
    )

    return MonthSummary(
        period=f"{year}-{month:02d}",
        total_income=total_income,
        total_expenses=total_expenses,
        balance=total_income - total_expenses,
        mortgage_payment=mortgage.payment_amount if mortgage else None,
        uva_value=macro.uva_value if macro else None,
        inflation_pct=macro.inflation_monthly_pct if macro else None,
        expenses_by_category=by_category,
    )


@router.get("/history", response_model=list[HistoryPoint])
async def history(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    tid = user.tenant_id

    data: dict[str, dict] = {}

    def ensure(p: str) -> None:
        if p not in data:
            data[p] = dict(
                total_income=Decimal(0),
                total_expenses=Decimal(0),
                mortgage_payment=None,
                uva_value=None,
                inflation_pct=None,
            )

    rows = await db.execute(
        select(
            func.date_trunc("month", IncomeEntry.period_date).label("p"),
            func.sum(IncomeEntry.amount).label("total"),
        )
        .where(IncomeEntry.tenant_id == tid)
        .group_by(text("1"))
    )
    for r in rows:
        k = str(r.p)[:7]
        ensure(k)
        data[k]["total_income"] = r.total

    rows = await db.execute(
        select(
            func.date_trunc("month", ExpenseEntry.expense_date).label("p"),
            func.sum(ExpenseEntry.amount).label("total"),
        )
        .where(ExpenseEntry.tenant_id == tid)
        .group_by(text("1"))
    )
    for r in rows:
        k = str(r.p)[:7]
        ensure(k)
        data[k]["total_expenses"] = r.total

    rows = await db.execute(
        select(
            func.date_trunc("month", MortgageRecord.period_date).label("p"),
            func.sum(MortgageRecord.payment_amount).label("total"),
        )
        .where(MortgageRecord.tenant_id == tid)
        .group_by(text("1"))
    )
    for r in rows:
        k = str(r.p)[:7]
        ensure(k)
        data[k]["mortgage_payment"] = r.total

    rows = await db.execute(
        select(
            func.date_trunc("month", MacroVariable.period_date).label("p"),
            func.max(MacroVariable.uva_value).label("uva"),
            func.max(MacroVariable.inflation_monthly_pct).label("inflation"),
        )
        .where(MacroVariable.tenant_id == tid)
        .group_by(text("1"))
    )
    for r in rows:
        k = str(r.p)[:7]
        ensure(k)
        data[k]["uva_value"] = r.uva
        data[k]["inflation_pct"] = r.inflation

    return [HistoryPoint(period=k, **data[k]) for k in sorted(data.keys())]

