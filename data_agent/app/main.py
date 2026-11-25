"""API del data agent (microservizio interno, chiamato solo dal back end).

Endpoint:
- GET  /health              stato del servizio e del dataset pulito (senza autenticazione)
- POST /analyze             esegue un'analisi: {task} -> {answer, code, charts, table, cleaning, ...}
- GET  /charts/{chart_id}   immagine PNG di un grafico generato
- DELETE /charts/{chart_id} elimina un grafico (conversazione cancellata)
- GET  /cleaning            codice e report della pulizia applicata
- POST /cleaning/rebuild    aggiorna (riusa il codice validato) o rigenera (LLM) la pulizia
- GET  /dataset             dati grezzi o puliti, paginati e filtrabili
- PATCH /dataset/rows/{id}  modifica una cella del CSV grezzo
- GET/PUT /dictionary       dizionario dati (regole di qualità e di calcolo)

Le richieste possono indicare `model` e `api_key`: sono le impostazioni scelte dall'utente nel back end,
usate solo per quella richiesta e mai registrate nei log.
"""

from __future__ import annotations

import asyncio
import logging
import re
import secrets
import threading
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, SecretStr

from . import dataset
from .agent import DataAnalyst
from .cleaning import CleanedData, prepare_clean_data
from .llm import build_llm
from .config import Settings, get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("data_agent")

CHART_ID = re.compile(r"^[0-9a-f]{32}$")


class State:
    def __init__(self) -> None:
        self.data: CleanedData | None = None
        self.analyst: DataAnalyst | None = None
        self.status = "starting"  # starting | cleaning | ready | error
        self.refreshing = False  # pulizia in aggiornamento mentre si continua a servire la versione precedente
        self.error: str | None = None
        self.lock = threading.Lock()


state = State()


def _prepare(settings: Settings, force: bool = False, llm=None) -> None:
    with state.lock:
        serving = state.analyst is not None
        if serving:
            state.refreshing = True  # le analisi continuano sui dati precedenti fino al cambio
        else:
            state.status = "cleaning"
        state.error = None
        try:
            data = prepare_clean_data(settings, force=force, llm=llm)
            state.data, state.analyst = data, DataAnalyst(settings, data)
            state.status = "ready"
            log.info("dataset pronto (%s): %s", data.source, data.stats)
        except Exception as exc:
            state.error = str(exc)[:1000]
            if not serving:
                state.status = "error"
            log.exception("preparazione del dataset fallita")
        finally:
            state.refreshing = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.semaphore = asyncio.Semaphore(settings.max_concurrent_analyses)
    # La pulizia (eventualmente generata dall'LLM) gira in background: /health risponde subito.
    threading.Thread(target=_prepare, args=(settings,), daemon=True).start()
    yield


app = FastAPI(title="Wayfare Media — Data Agent", version="1.0.0", lifespan=lifespan)


def require_token(x_internal_token: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().data_agent_token.get_secret_value()
    if not x_internal_token or not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail="Token interno mancante o non valido.")


class LlmOverride(BaseModel):
    model: str | None = Field(default=None, max_length=200, pattern=r"^[A-Za-z0-9._:/~-]+$")
    api_key: SecretStr | None = Field(default=None, max_length=300)

    def llm(self):
        if not self.model and not self.api_key:
            return None
        return build_llm(get_settings(), self.model, self.api_key.get_secret_value() if self.api_key else None)


class AnalyzeRequest(LlmOverride):
    task: str = Field(min_length=3, max_length=4000, description="Compito di analisi autonomo, in italiano.")
    request_id: str | None = Field(default=None, max_length=64)


class RebuildRequest(LlmOverride):
    mode: str = Field(default="refresh", pattern="^(refresh|regenerate)$")


class CellUpdate(BaseModel):
    column: str = Field(min_length=1, max_length=64)
    value: str = Field(max_length=200)


class DictionaryUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=dataset.MAX_DICTIONARY_CHARS)


class AnalyzeResponse(BaseModel):
    answer: str
    code: list[str]
    charts: list[str]
    table: dict | None
    cleaning: dict
    steps: int
    duration_ms: int
    error: str | None


@app.get("/health")
def health() -> dict:
    body = {"status": state.status, "refreshing": state.refreshing, "model": get_settings().llm_model}
    if state.data:
        body["dataset"] = {**state.data.stats, "pulizia": state.data.source}
    if state.error:
        body["error"] = state.error
    return body


@app.post("/analyze", response_model=AnalyzeResponse, dependencies=[Depends(require_token)])
async def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    if state.status != "ready" or state.analyst is None or state.data is None:
        raise HTTPException(status_code=503, detail=f"Dataset non pronto (stato: {state.status}).")
    settings = get_settings()
    log.info("analyze request_id=%s model=%s task=%r", req.request_id, req.model or "default", req.task[:200])
    analyst, data = state.analyst, state.data
    async with app.state.semaphore:
        try:
            result = await asyncio.wait_for(
                run_in_threadpool(analyst.analyze, req.task, req.llm()), timeout=settings.request_timeout_s + 15
            )
        except TimeoutError:
            raise HTTPException(status_code=504, detail="Analisi troppo lunga: riprova con una domanda più specifica.")
    return AnalyzeResponse(
        answer=result.answer, code=result.code, charts=result.charts, table=result.table,
        cleaning={"fonte": data.source, "report": data.report, **data.stats},
        steps=result.steps, duration_ms=result.duration_ms, error=result.error,
    )


@app.get("/charts/{chart_id}", dependencies=[Depends(require_token)])
def chart(chart_id: str) -> FileResponse:
    if not CHART_ID.fullmatch(chart_id):  # niente path traversal: solo id esadecimali generati dal servizio
        raise HTTPException(status_code=400, detail="Identificativo grafico non valido.")
    path = get_settings().charts_dir / f"{chart_id}.png"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Grafico non trovato.")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@app.delete("/charts/{chart_id}", status_code=204, dependencies=[Depends(require_token)])
def delete_chart(chart_id: str) -> None:
    if not CHART_ID.fullmatch(chart_id):
        raise HTTPException(status_code=400, detail="Identificativo grafico non valido.")
    (get_settings().charts_dir / f"{chart_id}.png").unlink(missing_ok=True)


@app.get("/cleaning", dependencies=[Depends(require_token)])
def cleaning() -> dict:
    if state.data is None:
        raise HTTPException(status_code=503, detail=f"Dataset non pronto (stato: {state.status}).")
    return {"fonte": state.data.source, "stats": state.data.stats, "report": state.data.report,
            "codice": state.data.code, "status": state.status, "refreshing": state.refreshing, "error": state.error}


@app.post("/cleaning/rebuild", status_code=202, dependencies=[Depends(require_token)])
def rebuild(req: RebuildRequest | None = None) -> dict:
    req = req or RebuildRequest()
    if state.status == "cleaning" or state.refreshing:
        raise HTTPException(status_code=409, detail="Pulizia già in corso.")
    args = (get_settings(), req.mode == "regenerate", req.llm())
    threading.Thread(target=_prepare, args=args, daemon=True).start()
    return {"status": "refreshing" if state.analyst else "cleaning", "mode": req.mode}


@app.get("/dataset", dependencies=[Depends(require_token)])
def get_dataset(view: str = "raw", page: int = 1, page_size: int = 50, q: str = "") -> dict:
    if view not in ("raw", "clean") or page < 1 or not 1 <= page_size <= 200 or len(q) > 100:
        raise HTTPException(status_code=400, detail="Parametri non validi.")
    settings = get_settings()
    if view == "raw":
        return dataset.raw_page(settings.data_csv_path, page, page_size, q.strip())
    if state.data is None:
        raise HTTPException(status_code=503, detail=f"Dataset non pronto (stato: {state.status}).")
    return dataset.clean_page(state.data.complete_path, page, page_size, q.strip())


@app.patch("/dataset/rows/{row_id}", dependencies=[Depends(require_token)])
def update_row(row_id: str, req: CellUpdate) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", row_id):
        raise HTTPException(status_code=400, detail="Identificativo di riga non valido.")
    try:
        change = dataset.update_cell(get_settings().data_csv_path, row_id, req.column, req.value)
    except KeyError:
        raise HTTPException(status_code=404, detail="Riga non trovata.")
    except dataset.DatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    log.info("dataset: %s.%s modificata", row_id, req.column)
    return change


@app.get("/dictionary", dependencies=[Depends(require_token)])
def get_dictionary() -> dict:
    return {"content": dataset.read_dictionary(get_settings().data_dictionary_path)}


@app.put("/dictionary", dependencies=[Depends(require_token)])
def put_dictionary(req: DictionaryUpdate) -> dict:
    try:
        dataset.write_dictionary(get_settings().data_dictionary_path, req.content)
    except dataset.DatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    log.info("dizionario dati aggiornato (%d caratteri)", len(req.content))
    return {"ok": True}
