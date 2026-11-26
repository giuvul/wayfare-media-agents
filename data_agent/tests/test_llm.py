"""Temperatura inviata solo ai modelli che la accettano (con require_parameters OpenRouter rifiuterebbe la richiesta)."""

import io
import json

import app.llm as llm
from app.config import get_settings

CATALOG = {"data": [
    {"id": "deepseek/deepseek-v4.1-flash", "supported_parameters": ["tools", "temperature"]},
    {"id": "anthropic/claude-haiku-5.5", "supported_parameters": ["tools", "reasoning"]},
]}


def _reset(monkeypatch, response):
    monkeypatch.setattr(llm, "_catalog", {"at": 0.0, "temperature": set(), "failed_at": 0.0})

    def fake_urlopen(url, timeout):
        if isinstance(response, Exception):
            raise response
        return io.BytesIO(json.dumps(response).encode())

    monkeypatch.setattr(llm.urllib.request, "urlopen", fake_urlopen)


def test_temperatura_solo_per_i_modelli_che_la_supportano(monkeypatch):
    _reset(monkeypatch, CATALOG)
    s = get_settings()
    assert llm.build_llm(s, "deepseek/deepseek-v4.1-flash").temperature == 0
    assert llm.build_llm(s, "anthropic/claude-haiku-5.5").temperature is None


def test_senza_catalogo_la_temperatura_viene_omessa(monkeypatch):
    _reset(monkeypatch, OSError("rete non disponibile"))
    assert llm.build_llm(get_settings(), "deepseek/deepseek-v4.1-flash").temperature is None
