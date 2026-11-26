"""Configurazione del data agent, letta dalle variabili d'ambiente (file .env alla radice del repo)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = SERVICE_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # LLM via OpenRouter (API compatibile OpenAI), attraverso il proxy del back end: il data agent non possiede la
    # chiave OpenRouter e si autentica al proxy con il token interno
    llm_proxy_url: str = "http://localhost:3001/internal/llm"
    llm_proxy_wait_s: float = 600.0  # attesa massima del back end all'avvio, se la pulizia va generata con l'LLM
    llm_model: str
    llm_fallback_models: str = ""  # lista separata da virgole, usata da OpenRouter se il modello principale fallisce
    llm_timeout_s: float = 45.0

    # Sicurezza: segreto condiviso con il back end (header X-Internal-Token)
    data_agent_token: SecretStr = Field(min_length=16)  # stessa regola del back end

    # Dati
    data_csv_path: Path = REPO_DIR / "data" / "campagne_wayfare.csv"
    data_dictionary_path: Path = REPO_DIR / "data" / "dizionario_dati.md"
    charts_dir: Path = SERVICE_DIR / "charts"
    cache_dir: Path = SERVICE_DIR / "cache"

    # Limiti di esecuzione (catena dei timeout: chat 120 s > richiesta 60 s > singola esecuzione 15 s);
    # il back end può concedere meno tempo per singola richiesta (timeout_s, scadenza del turno propagata)
    exec_timeout_s: float = 15.0
    cleaning_exec_timeout_s: float = 60.0  # il codice di pulizia lavora sull'intero dataset grezzo
    request_timeout_s: float = 60.0
    max_agent_steps: int = Field(default=10, ge=2, le=20)
    max_concurrent_analyses: int = Field(default=2, ge=1, le=8)
    cleaning_max_attempts: int = Field(default=3, ge=1, le=5)

    @property
    def fallback_models(self) -> list[str]:
        return [m.strip() for m in self.llm_fallback_models.split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


# OPENROUTER_API_KEY non è tra le impostazioni, ma se fosse nell'ambiente (es. avvio a mano) va tolta comunque
SECRET_ENV = ("OPENROUTER_API_KEY", "DATA_AGENT_TOKEN")


def scrub_secret_env() -> None:
    """Toglie i segreti dall'ambiente del processo dopo averli letti nelle impostazioni.

    I processi figli della sandbox ricevono l'ambiente del server: senza questa pulizia il codice generato
    potrebbe leggere la chiave da `/proc/self/environ`, anche se il figlio la toglie da `os.environ`.
    """
    get_settings()  # i valori restano nelle impostazioni già lette
    for name in SECRET_ENV:
        os.environ.pop(name, None)
