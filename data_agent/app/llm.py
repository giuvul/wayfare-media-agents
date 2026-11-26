"""Client LLM: un solo punto in cui si sceglie provider e modello (vendor-agnostic via OpenRouter).

Le chiamate passano dal proxy del back end (`/internal/llm`): il data agent, che esegue codice generato dal modello,
non possiede la chiave OpenRouter. Al proxy si autentica con il token interno, e il back end aggiunge la chiave.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request

from langchain_openai import ChatOpenAI

from .config import Settings

log = logging.getLogger("data_agent.llm")

_CATALOG_TTL_S = 3600
_CATALOG_RETRY_S = 60  # dopo un errore: non si ritenta a ogni richiesta (ognuna aspetterebbe il timeout)
_catalog: dict = {"at": 0.0, "temperature": set(), "failed_at": 0.0}
_catalog_lock = threading.Lock()


def _auth(settings: Settings) -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.data_agent_token.get_secret_value()}"}


def wait_for_proxy(settings: Settings, interval_s: float = 3.0) -> None:
    """Attende che il back end risponda. Serve all'avvio: in Docker il data agent parte prima del back end, e la
    prima pulizia dei dati chiama il modello."""
    url = f"{settings.llm_proxy_url}/health"
    deadline = time.monotonic() + settings.llm_proxy_wait_s
    while True:
        try:
            with urllib.request.urlopen(url, timeout=3) as res:
                if res.status == 200:
                    return
        except OSError:
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError(f"il back end non risponde su {url}: le chiamate al modello passano dal suo proxy")
        time.sleep(interval_s)


def supports_temperature(settings: Settings, model: str) -> bool:
    """True se il catalogo OpenRouter dichiara `temperature` per il modello.

    Con `require_parameters` OpenRouter rifiuta (404) una richiesta con un parametro che il modello non accetta, e
    i modelli più recenti di Anthropic e OpenAI non accettano la temperatura. Se il catalogo non è raggiungibile
    si omette il parametro: una richiesta senza temperatura è accettata da tutti i modelli.
    """
    with _catalog_lock:
        now = time.monotonic()
        stale = not _catalog["at"] or now - _catalog["at"] > _CATALOG_TTL_S
        if stale and now - _catalog["failed_at"] > _CATALOG_RETRY_S:
            try:
                request = urllib.request.Request(f"{settings.llm_proxy_url}/models", headers=_auth(settings))
                with urllib.request.urlopen(request, timeout=15) as res:
                    data = json.load(res)["data"]
                _catalog["temperature"] = {m["id"] for m in data if "temperature" in (m.get("supported_parameters") or [])}
                _catalog["at"] = time.monotonic()
            except Exception as exc:  # rete, formato: si omette la temperatura e si riprova più tardi
                _catalog["failed_at"] = now
                log.warning("catalogo modelli non disponibile: %s", exc)
                return False
        return model in _catalog["temperature"]


def build_llm(settings: Settings, model: str | None = None, timeout_s: float | None = None) -> ChatOpenAI:
    """Modello di default dal .env; il back end può sostituirlo per richiesta (impostazioni dell'utente)."""
    model = model or settings.llm_model
    extra_body: dict = {
        # instrada solo verso provider che supportano tutti i parametri richiesti (es. tool calling)
        "provider": {"require_parameters": True},
    }
    fallbacks = [m for m in settings.fallback_models if m != model]
    if fallbacks:
        # fallback lato OpenRouter: se il modello principale è indisponibile (429/5xx) prova i successivi
        extra_body["models"] = [model, *fallbacks]
    return ChatOpenAI(
        model=model,
        api_key=settings.data_agent_token,  # per il proxy del back end, che lo sostituisce con la chiave OpenRouter
        base_url=settings.llm_proxy_url,
        # temperatura 0 (codice e numeri ripetibili) solo dove il modello la accetta
        **({"temperature": 0} if supports_temperature(settings, model) else {}),
        timeout=min(settings.llm_timeout_s, timeout_s or settings.llm_timeout_s),
        max_retries=1,
        extra_body=extra_body,
    )
