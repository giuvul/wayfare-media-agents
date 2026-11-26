"""Il validatore deve accettare la pulizia corretta e rifiutare gli errori tipici."""

import pandas as pd
import pytest
from generate_dataset import reference_clean

from app.cleaning import build_profile, validate
from app.quality import analyze, blocking_problems, parse_dictionary, residuals


@pytest.fixture(scope="module")
def reference(raw_df):
    return reference_clean(raw_df).drop(columns=["riga_valida"])


def test_reference_cleaning_passes(raw_df, reference):
    assert validate(raw_df, reference) == []


def test_reference_matches_ground_truth(reference, ground_truth):
    valid = reference[reference["impression_erogate"].notna()]
    assert len(reference) == ground_truth["righe_dopo_deduplica"]
    assert int(valid["impression_erogate"].sum()) == ground_truth["totale_impression_erogate"]


def test_rejects_cpm_parsed_ten_times_too_high(raw_df, reference):
    broken = reference.copy()
    broken.loc[broken.index[:50], "cpm_contrattuale"] *= 10  # "16.2" letto come 162
    assert any("cpm_contrattuale" in e for e in validate(raw_df, broken))


def test_rejects_leftover_duplicates(raw_df, reference):
    broken = reference.copy()
    broken = pd.concat([broken, broken.iloc[[0]]])
    errors = validate(raw_df, broken)
    assert any("duplicati" in e for e in errors)


def test_rejects_dropping_invalid_rows(raw_df, reference):
    broken = reference[reference["impression_erogate"].notna()]
    assert validate(raw_df, broken)


def test_rejects_non_canonical_categories(raw_df, reference):
    broken = reference.copy()
    broken.loc[broken.index[0], "settore"] = "Luxury"
    assert any("settore" in e for e in validate(raw_df, broken))


def test_rejects_unparsed_dates(raw_df, reference):
    broken = reference.copy()
    broken.loc[broken.index[0], "data"] = pd.NaT
    assert any("data" in e for e in validate(raw_df, broken))


@pytest.fixture(scope="module")
def schema():
    from conftest import REPO_DIR

    return parse_dictionary((REPO_DIR / "data" / "dizionario_dati.md").read_text(encoding="utf-8"))


def test_quality_analysis_finds_every_injected_anomaly(raw_df, schema, ground_truth):
    """L'analisi deterministica ritrova tutte le anomalie iniettate dal generatore, con il numero esatto di righe."""
    found = {c["id"]: c["righe"] for c in analyze(raw_df, schema)["anomalie"]}
    injected = ground_truth["anomalie_iniettate"]
    expected = {
        "id_riga:duplicati_identici": injected["righe_duplicate"],
        "data:data_gg/mm/aaaa": injected["date_formato_gg_mm_aaaa"],
        "data:data_testuale": injected["date_formato_testuale"],
        "settore:non_canonici": injected["settore_scritto_diversamente"],
        "aeroporto:non_canonici": injected["aeroporto_scritto_diversamente"],
        "segmento_audience:mancanti": injected["segmento_mancante"],
        "impression_erogate:mancanti": injected["impression_erogate_mancanti"],
        "impression_erogate:negativi": injected["impression_erogate_negative"],
        "dwell_medio_sec:fuori_intervallo": injected["dwell_fuori_range"],
        "cpm_contrattuale:valuta_testo": injected["cpm_come_testo_valuta"],
        "spesa_eur:mancanti": injected["spesa_mancante"],
        "creativita_in_ritardo:booleani_testuali": injected["creativita_flag_testuale"],
        "scansioni_qr:oltre_impression": injected["scansioni_qr_maggiori_di_impression"],
    }
    assert {k: found.get(k) for k in expected} == expected


def test_quality_proposes_canonical_values(raw_df, schema):
    settore = next(c for c in analyze(raw_df, schema)["anomalie"] if c["id"] == "settore:non_canonici")
    proposals = {d["valore"]: d["proposta"] for d in settore["dettaglio"]}
    assert proposals["Fashion"] == "Moda" and proposals["Food&Beverage"] == "Food & Beverage"


def test_reference_cleaning_leaves_no_blocking_anomaly(raw_df, reference, schema):
    raw_q, clean_q = analyze(raw_df, schema), analyze(reference, schema)
    assert blocking_problems(clean_q) == []
    left = {k: v for k, v in residuals(raw_q, clean_q).items() if v}
    assert left == {"impression_erogate:mancanti": 145, "spesa_eur:mancanti": 1}  # righe non valide, restano NaN


def test_rare_anomaly_ignored_by_cleaning_is_caught(reference, schema):
    """Un'anomalia in una sola riga, non coperta dai controlli di business, fa comunque rifiutare la pulizia."""
    broken = reference.copy()
    broken.loc[broken.index[7], "terminal"] = " T2"
    assert validate_passes(broken)
    problems = blocking_problems(analyze(broken, schema))
    assert len(problems) == 1 and "terminal" in problems[0] and "1 righe" in problems[0]


def validate_passes(df):
    from conftest import REPO_DIR

    raw = pd.read_csv(REPO_DIR / "data" / "campagne_wayfare.csv")
    return validate(raw, df) == []


def test_profile_for_the_llm_contains_the_full_analysis(raw_df, schema):
    profile = build_profile(raw_df, schema)
    assert profile["qualita"]["righe_analizzate"] == raw_df["id_riga"].nunique()
    assert profile["colonne_dettaglio"]["cpm_contrattuale"]["max"] < 100  # "16,20 €" letto come 16.2
