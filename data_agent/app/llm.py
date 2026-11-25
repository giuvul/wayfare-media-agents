"""Client LLM: un solo punto in cui si sceglie provider e modello (vendor-agnostic via OpenRouter)."""

from __future__ import annotations

from langchain_openai import ChatOpenAI

from .config import Settings


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
        temperature=0,
        timeout=settings.llm_timeout_s,
        max_retries=1,
        extra_body=extra_body,
        default_headers={"X-Title": "Wayfare Media Agents"},
    )
