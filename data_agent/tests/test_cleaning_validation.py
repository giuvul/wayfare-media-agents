"""Il validatore deve accettare la pulizia corretta e rifiutare gli errori tipici."""

import pandas as pd
import pytest

from app.cleaning import build_profile, validate
from generate_dataset import reference_clean


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


def test_profile_shows_inconsistent_formats_without_naming_anomalies(raw_df):
    profile = build_profile(raw_df)
    assert profile["righe_con_id_riga_ripetuto"] > 0
    shapes = profile["colonne_dettaglio"]["data"]["esempi_forme_diverse"]
    assert len(shapes) >= 3  # ISO, gg/mm/aaaa e testuale emergono come forme diverse
