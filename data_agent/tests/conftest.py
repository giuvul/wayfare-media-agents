import os
import sys
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = SERVICE_DIR.parent
sys.path.insert(0, str(SERVICE_DIR))
sys.path.insert(0, str(REPO_DIR / "data" / "generator"))

# I test offline non chiamano il modello: valori fittizi solo se manca il .env
# (le variabili d'ambiente hanno la precedenza sul file, quindi non vanno impostate se il .env esiste).
if not (REPO_DIR / ".env").exists():
    os.environ.setdefault("LLM_MODEL", "test/modello")
    os.environ.setdefault("DATA_AGENT_TOKEN", "test-token-0123456789")


@pytest.fixture(scope="session")
def raw_df():
    import pandas as pd

    return pd.read_csv(REPO_DIR / "data" / "campagne_wayfare.csv")


@pytest.fixture(scope="session")
def ground_truth():
    import json

    return json.loads((REPO_DIR / "data" / "generator" / "ground_truth.json").read_text(encoding="utf-8"))
