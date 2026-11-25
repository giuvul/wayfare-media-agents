"""API del data agent (microservizio interno, chiamato solo dal back end).

Endpoint:
- GET  /health              stato del servizio e del dataset pulito (senza autenticazione)
- POST /analyze             esegue un'analisi: {task} -> {answer, code, charts, table, cleaning, ...}
- GET  /charts/{chart_id}   immagine PNG di un grafico generato
- GET  /cleaning            codice e report della pulizia applicata
- POST /cleaning/rebuild    rigenera la pulizia (es. dopo aver cambiato il CSV)
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
from pydantic import BaseModel, Field

from .agent import DataAnalyst
from .cleaning import CleanedData, prepare_clean_data
from .config import Settings, get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("data_agent")

CHART_ID = re.compile(r"^[0-9a-f]{32}$")


class State:
    def __init__(self) -> None:
        self.data: CleanedData | None = None
        self.analyst: DataAnalyst | None = None
        self.status = "starting"  # starting | cleaning | ready | error
        self.error: str | None = None
        self.lock = threading.Lock()


state = State()


def _prepare(settings: Settings, force: bool = False) -> None:
    with state.lock:
        state.status, state.error = "cleaning", None
        try:
            state.data = prepare_clean_data(settings, force=force)
            state.analyst = DataAnalyst(settings, state.data)
            state.status = "ready"
            log.info("dataset pronto (%s): %s", state.data.source, state.data.stats)
        except Exception as exc:
            state.status, state.error = "error", str(exc)[:1000]
            log.exception("preparazione del dataset fallita")


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


class AnalyzeRequest(BaseModel):
    task: str = Field(min_length=3, max_length=4000, description="Compito di analisi autonomo, in italiano.")
    request_id: str | None = Field(default=None, max_length=64)


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
    body = {"status": state.status, "model": get_settings().llm_model}
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
    log.info("analyze request_id=%s task=%r", req.request_id, req.task[:200])
    async with app.state.semaphore:
        try:
            result = await asyncio.wait_for(
                run_in_threadpool(state.analyst.analyze, req.task), timeout=settings.request_timeout_s + 15
            )
        except TimeoutError:
            raise HTTPException(status_code=504, detail="Analisi troppo lunga: riprova con una domanda più specifica.")
    return AnalyzeResponse(
        answer=result.answer, code=result.code, charts=result.charts, table=result.table,
        cleaning={"fonte": state.data.source, "report": state.data.report, **state.data.stats},
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


@app.get("/cleaning", dependencies=[Depends(require_token)])
def cleaning() -> dict:
    if state.data is None:
        raise HTTPException(status_code=503, detail=f"Dataset non pronto (stato: {state.status}).")
    return {"fonte": state.data.source, "stats": state.data.stats, "report": state.data.report, "codice": state.data.code}


@app.post("/cleaning/rebuild", status_code=202, dependencies=[Depends(require_token)])
def rebuild() -> dict:
    if state.status == "cleaning":
        raise HTTPException(status_code=409, detail="Pulizia già in corso.")
    threading.Thread(target=_prepare, args=(get_settings(), True), daemon=True).start()
    return {"status": "cleaning"}
