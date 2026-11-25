# Data agent: microservizio interno (non esposto all'host). Esegue il codice generato dall'LLM in una sandbox.
# Build dalla radice del repository: docker build -f data_agent/Dockerfile .
FROM python:3.13.16-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /app/data_agent

COPY data_agent/requirements.txt ./
RUN pip install -r requirements.txt

COPY data_agent/app ./app
# dataset e dizionario iniziali: il volume montato su /app/data viene popolato da qui al primo avvio
COPY data/campagne_wayfare.csv data/dizionario_dati.md /app/data/

# utente senza privilegi; scrivibili solo dati, cache della pulizia e grafici (il resto è in sola lettura in compose)
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin wayfare \
 && mkdir -p cache charts \
 && chown -R wayfare /app/data cache charts
USER wayfare
EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
