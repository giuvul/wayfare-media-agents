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


def test_le_chiamate_passano_dal_proxy_del_back_end_con_il_token_interno(monkeypatch):
    """Il data agent non possiede la chiave OpenRouter: si autentica al proxy con il token interno."""
    _reset(monkeypatch, CATALOG)
    s = get_settings()
    client = llm.build_llm(s, "deepseek/deepseek-v4.1-flash")
    assert client.openai_api_base == s.llm_proxy_url
    assert client.openai_api_key.get_secret_value() == s.data_agent_token.get_secret_value()
    assert not hasattr(s, "openrouter_api_key")


def test_catalogo_letto_dal_proxy_con_il_token(monkeypatch):
    _reset(monkeypatch, CATALOG)
    seen = []

    def fake_urlopen(request, timeout):
        seen.append(request)
        return io.BytesIO(json.dumps(CATALOG).encode())

    monkeypatch.setattr(llm.urllib.request, "urlopen", fake_urlopen)
    s = get_settings()
    assert llm.supports_temperature(s, "deepseek/deepseek-v4.1-flash")
    assert seen[0].full_url == f"{s.llm_proxy_url}/models"
    assert seen[0].get_header("Authorization") == f"Bearer {s.data_agent_token.get_secret_value()}"


def test_attesa_del_proxy_con_limite(monkeypatch):
    s = get_settings().model_copy(update={"llm_proxy_wait_s": 0.0})

    def refused(url, timeout):
        raise ConnectionRefusedError("back end non avviato")

    monkeypatch.setattr(llm.urllib.request, "urlopen", refused)
    import pytest

    with pytest.raises(RuntimeError, match="proxy"):
        llm.wait_for_proxy(s, interval_s=0)
