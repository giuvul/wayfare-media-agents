"""Test con il modello vero: la pulizia generata e le analisi devono coincidere con il ground truth.

Eseguili con `pytest -m llm` con il back end avviato: le chiamate al modello passano dal suo proxy (consumano credito).
"""

import contextlib
import pickle
import re

import pytest

from app.agent import DataAnalyst
from app.cleaning import prepare_clean_data
from app.config import get_settings

pytestmark = pytest.mark.llm


@pytest.fixture(scope="module")
def data():
    return prepare_clean_data(get_settings())


def _numbers(text: str) -> list[float]:
    values = []
    for token in re.findall(r"\d[\d.,]*", text):
        token = token.rstrip(".,")
        if "," in token:
            token = token.replace(".", "").replace(",", ".")
        elif token.count(".") > 1 or re.fullmatch(r"\d{1,3}(\.\d{3})+", token):
            token = token.replace(".", "")
        with contextlib.suppress(ValueError):
            values.append(float(token))
    return values


def _mentions(text: str, expected: float, tolerance: float) -> bool:
    return any(abs(v - expected) <= tolerance for v in _numbers(text))


def test_generated_cleaning_matches_ground_truth(data, ground_truth):
    with open(data.valid_path, "rb") as fh:
        df = pickle.load(fh)
    assert data.stats["righe_dopo_deduplica"] == ground_truth["righe_dopo_deduplica"]
    assert len(df) == ground_truth["righe_valide_per_kpi_erogazione"]
    assert int(df["impression_erogate"].sum()) == ground_truth["totale_impression_erogate"]
    assert df["spesa_eur"].sum() == pytest.approx(ground_truth["totale_spesa_eur"], abs=1)


def test_cpm_per_formato(data, ground_truth):
    result = DataAnalyst(get_settings(), data).analyze("Calcola il CPM effettivo per formato su tutto il periodo.")
    assert result.error is None
    for value in ground_truth["cpm_effettivo_per_formato"].values():
        assert _mentions(result.answer + str(result.table), value, 0.01)


def test_make_good_total(data, ground_truth):
    task = ("Regola (handbook 5.1-5.3): campagne concluse (data_fine_flight <= data di estrazione) con erogato < 95% "
            "del pianificato (somma su aeroporti e giorni) hanno diritto a un make-good = (pianificate - erogate) x "
            "CPM contrattuale / 1000; escluse le campagne con creativita_in_ritardo. Quante sono e quanto vale il totale?")
    result = DataAnalyst(get_settings(), data).analyze(task)
    mg = ground_truth["make_good"]
    assert _mentions(result.answer, len(mg["campagne_aventi_diritto"]), 0)
    assert _mentions(result.answer, mg["valore_totale_eur"], 1.0)


def test_sconti_fuori_policy(data, ground_truth):
    task = ("Regola (handbook 3.3): lo sconto complessivo sul listino non può superare il 25% "
            "(cpm_contrattuale < 75% di cpm_listino è fuori policy). Quali campagne sono fuori policy?")
    result = DataAnalyst(get_settings(), data).analyze(task)
    text = result.answer + str(result.table)
    found = [cid for cid in ground_truth["campagne_sconto_fuori_policy"] if cid in text]
    assert len(found) == len(ground_truth["campagne_sconto_fuori_policy"])
