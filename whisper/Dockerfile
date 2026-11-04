FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

# El modelo va adentro de la imagen: el contenedor corre sin salida a internet.
ARG WHISPER_MODEL=turbo
ENV WHISPER_MODEL=${WHISPER_MODEL} HF_HOME=/models
RUN python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['WHISPER_MODEL'], device='cpu', compute_type='int8')"
ENV HF_HUB_OFFLINE=1

COPY app.py .
RUN useradd --create-home whisper
USER whisper

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9000", "--no-access-log"]
