from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, income, expenses, macro, dashboard, mortgage

app = FastAPI(
    title="RegistrApp API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

import os

_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001")
_origins = [o.strip() for o in _raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(income.router)
app.include_router(expenses.router)
app.include_router(macro.router)
app.include_router(dashboard.router)
app.include_router(mortgage.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
