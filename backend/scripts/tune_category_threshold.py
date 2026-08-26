"""Medir el THRESHOLD de `services/category_suggest.py` contra datos reales.

Validación leave-one-out: para cada gasto con descripción se lo saca del corpus,
se busca su mejor match entre los demás y se compara la categoría sugerida con
la que realmente tiene. Se barren umbrales y se reportan dos números que tiran
en direcciones opuestas:

  precisión  — de las veces que sugirió, cuántas acertó
  cobertura  — de todos los gastos, en cuántos se animó a sugerir

**Precisión pesa más que cobertura**, y no es una preferencia estética: la
sugerencia llega como un chip *ya seleccionado*, así que una sugerencia
equivocada que el usuario no mira se guarda mal. No sugerir sólo le cuesta un
toque.

Uso (necesita el mismo venv que los importadores):

    DATABASE_URL=... FIREBASE_PROJECT_ID=dummy \
      ./.venv-import/bin/python -m scripts.tune_category_threshold [--tenant N]
"""
import argparse
import asyncio
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402

from app.models.expense import ExpenseCategory, ExpenseEntry  # noqa: E402
from app.services.category_suggest import jaccard, normalize  # noqa: E402

SWEEP = [0.20, 0.25, 0.30, 0.34, 0.40, 0.45, 0.50, 0.60, 0.70, 0.80, 1.00]


async def load(session: AsyncSession, tenant_id: int | None):
    stmt = (
        select(ExpenseEntry.description, ExpenseEntry.category_id,
               ExpenseCategory.name, ExpenseEntry.tenant_id)
        .join(ExpenseCategory, ExpenseCategory.id == ExpenseEntry.category_id)
        .where(ExpenseEntry.description.is_not(None), ExpenseEntry.description != "")
        .order_by(ExpenseEntry.expense_date.desc(), ExpenseEntry.id.desc())
    )
    if tenant_id is not None:
        stmt = stmt.where(ExpenseEntry.tenant_id == tenant_id)
    return (await session.execute(stmt)).all()


def evaluate(rows, threshold, novel_only=False):
    """Leave-one-out sobre las filas de un mismo hogar.

    `novel_only` deja afuera los gastos que tienen un gemelo exacto en el
    corpus (mismos tokens, Jaccard 1.0). Es el filtro que hace informativa la
    medición: en un hogar real la enorme mayoría de las descripciones se
    repiten literalmente, así que el barrido completo da ~100% de precisión en
    todos los umbrales y no dice nada. El umbral sólo decide sobre las
    descripciones que NO vio antes, y ése es justo el caso que el usuario
    percibe como "la app adivinó".
    """
    corpus = [(normalize(d), cid, name, d) for d, cid, name, _ in rows]
    corpus = [c for c in corpus if c[0]]
    suggested = correct = 0
    wrong_examples = []
    total = 0
    for i, (tokens, true_cid, _true_name, desc) in enumerate(corpus):
        best = None
        has_twin = False
        for j, (cand_tokens, cid, name, cand_desc) in enumerate(corpus):
            if i == j:
                continue
            s = jaccard(tokens, cand_tokens)
            if s == 1.0:
                has_twin = True
            if s >= threshold and (best is None or s > best[0]):
                best = (s, cid, name, cand_desc)
        if novel_only and has_twin:
            continue
        total += 1
        if best is None:
            continue
        suggested += 1
        if best[1] == true_cid:
            correct += 1
        elif len(wrong_examples) < 6:
            wrong_examples.append((desc, best[3], best[2], best[0]))
    return total, suggested, correct, wrong_examples


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", type=int, default=None)
    args = ap.parse_args()

    engine = create_async_engine(os.environ["DATABASE_URL"], echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        rows = await load(session, args.tenant)
    await engine.dispose()

    by_tenant = {}
    for r in rows:
        by_tenant.setdefault(r[3], []).append(r)
    # Un hogar con cuatro gastos no dice nada sobre el umbral.
    by_tenant = {t: rs for t, rs in by_tenant.items() if len(rs) >= 20}

    print(f"hogares evaluados: {len(by_tenant)}  "
          f"(gastos: {sum(len(v) for v in by_tenant.values())})\n")
    for novel_only in (False, True):
        titulo = ("SÓLO DESCRIPCIONES NUEVAS (sin gemelo exacto) — el segmento que decide"
                  if novel_only else "TODOS los gastos")
        print(f"\n── {titulo} ──")
        print(f"{'umbral':>7} {'cobertura':>11} {'precisión':>11} {'aciertos':>10}")
        print("  " + "-" * 42)
        for th in SWEEP:
            tot = sug = cor = 0
            for rs in by_tenant.values():
                t, s, c, _ = evaluate(rs, th, novel_only=novel_only)
                tot, sug, cor = tot + t, sug + s, cor + c
            cov = sug / tot if tot else 0
            prec = cor / sug if sug else 0
            print(f"{th:>7.2f} {cov:>10.1%} {prec:>10.1%} {cor:>6}/{sug}  (n={tot})")

    biggest = max(by_tenant, key=lambda t: len(by_tenant[t]))
    _, _, _, wrong = evaluate(by_tenant[biggest], 0.34, novel_only=True)
    if wrong:
        print(f"\nfalsos positivos a 0.34 (hogar {biggest}):")
        for desc, match, name, score in wrong:
            print(f"  {desc!r} → sugiere {name!r} por parecerse a {match!r} ({score:.2f})")


if __name__ == "__main__":
    asyncio.run(main())
