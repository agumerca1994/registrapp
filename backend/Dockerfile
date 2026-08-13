# Etapa de build: gcc y libpq-dev sólo se necesitan para compilar wheels. Antes
# era una sola etapa, así que el compilador viajaba en la imagen final — le deja
# armado un toolchain a cualquiera que consiga ejecución de código adentro.
FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt


FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /wheels /wheels
COPY requirements.txt .
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

COPY . .

# Sin USER, uvicorn y `alembic upgrade head` corren como root (UID 0 por defecto
# en python:3.12-slim). Eso convierte cualquier RCE — por ejemplo en el parser de
# PDF — en root adentro del contenedor, que es el punto de partida de casi
# cualquier cadena de escape.
RUN chmod +x /app/entrypoint.sh \
    && addgroup --system app \
    && adduser --system --ingroup app app \
    && chown -R app:app /app

USER app

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
