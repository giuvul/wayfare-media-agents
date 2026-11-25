"""Configurazione del data agent, letta dalle variabili d'ambiente (file .env alla radice del repo)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = SERVICE_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # LLM via OpenRouter (API compatibile OpenAI)
    openrouter_api_key: SecretStr
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str
    llm_fallback_models: str = ""  # lista separata da virgole, usata da OpenRouter se il modello principale fallisce
    llm_timeout_s: float = 45.0

    # Sicurezza: segreto condiviso con il back end (header X-Internal-Token)
    data_agent_token: SecretStr

    # Dati
    data_csv_path: Path = REPO_DIR / "data" / "campagne_wayfare.csv"
    data_dictionary_path: Path = REPO_DIR / "data" / "dizionario_dati.md"
    charts_dir: Path = SERVICE_DIR / "charts"
    cache_dir: Path = SERVICE_DIR / "cache"

    # Limiti di esecuzione (catena dei timeout: back end 90 s > richiesta 60 s > singola esecuzione 15 s)
    exec_timeout_s: float = 15.0
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
