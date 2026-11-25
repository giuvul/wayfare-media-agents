"""Client LLM: un solo punto in cui si sceglie provider e modello (vendor-agnostic via OpenRouter)."""

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
_catalog: dict = {"at": 0.0, "temperature": set()}
_catalog_lock = threading.Lock()


def supports_temperature(settings: Settings, model: str) -> bool:
    """True se il catalogo OpenRouter dichiara `temperature` per il modello.

    Con `require_parameters` OpenRouter rifiuta (404) una richiesta con un parametro che il modello non accetta, e
    i modelli più recenti di Anthropic e OpenAI non accettano la temperatura. Se il catalogo non è raggiungibile
    si omette il parametro: una richiesta senza temperatura è accettata da tutti i modelli.
    """
    with _catalog_lock:
        if time.monotonic() - _catalog["at"] > _CATALOG_TTL_S or not _catalog["at"]:
            try:
                with urllib.request.urlopen(f"{settings.openrouter_base_url}/models", timeout=15) as res:
                    data = json.load(res)["data"]
                _catalog["temperature"] = {m["id"] for m in data if "temperature" in (m.get("supported_parameters") or [])}
                _catalog["at"] = time.monotonic()
            except Exception as exc:  # rete, formato: si omette la temperatura e si riprova alla prossima richiesta
                log.warning("catalogo modelli non disponibile: %s", exc)
                return False
        return model in _catalog["temperature"]


def build_llm(settings: Settings, model: str | None = None, api_key: str | None = None) -> ChatOpenAI:
    """Modello e chiave di default dal .env; il back end può sostituirli per richiesta (impostazioni dell'utente)."""
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
        api_key=api_key or settings.openrouter_api_key,
        base_url=settings.openrouter_base_url,
        # temperatura 0 (codice e numeri ripetibili) solo dove il modello la accetta
        **({"temperature": 0} if supports_temperature(settings, model) else {}),
        timeout=settings.llm_timeout_s,
        max_retries=1,
        extra_body=extra_body,
        default_headers={"X-Title": "Wayfare Media Agents"},
    )
