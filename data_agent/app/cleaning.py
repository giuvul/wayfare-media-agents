"""Pulizia dati autonoma ma verificabile.

L'agente riceve un profilo di qualità generico del CSV e il dizionario dati, e scrive da sé il codice
di pulizia. Il codice gira nella sandbox; il risultato deve superare controlli deterministici
(`validate`). Se non li supera, l'agente riceve gli errori e riprova. Il codice valido, il report e i
DataFrame puliti vengono salvati in cache e riusati da tutte le analisi successive: stessi dati, stessi
numeri a ogni domanda (interprete deterministico).
"""

from __future__ import annotations

import hashlib
import json
import logging
import pickle
import re
import time
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from langchain_core.messages import HumanMessage, SystemMessage

from .config import Settings
from .llm import build_llm
from .sandbox import Sandbox

log = logging.getLogger("data_agent.cleaning")

NUMERIC_COLUMNS = [
    "impression_pianificate", "impression_erogate", "reach", "dwell_medio_sec", "scansioni_qr",
    "conversioni", "cpm_listino", "cpm_contrattuale", "spesa_eur",
]
AEROPORTI = {"FCO", "MXP", "LIN", "BGY", "VCE", "NAP", "BLQ", "CTA"}
SETTORI = {"Lusso", "Moda", "Beauty", "Automotive", "Finanza", "Travel", "Food & Beverage", "Telco", "Tecnologia"}
SEGMENTI = {"Business", "Leisure", "Luxury Traveller", "Famiglie", "Giovani Esploratori", "Non classificato"}
FORMATI = {"Gate Screen", "Digital Totem", "Lounge Screen", "Wi-Fi Portal", "Baggage Claim Wall"}

CLEANING_SYSTEM_PROMPT = """Sei un data engineer senior. Scrivi codice Python (pandas) di qualità produzione.
Rispondi SOLO con un blocco ```python ... ``` che definisce la funzione richiesta, senza spiegazioni fuori dal blocco."""

CLEANING_TASK = """Devi pulire l'export delle campagne pubblicitarie descritto qui sotto.

## Dizionario dati e regole concordate con il business
{dizionario}

## Profilo di qualità del file grezzo (calcolato automaticamente)
```json
{profilo}
```

## Cosa scrivere
Una funzione `pulisci(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]` che:
- riceve il DataFrame grezzo (tutte le colonne lette come da pd.read_csv) e restituisce il DataFrame pulito
  e un report: una lista di frasi in italiano, una per passo, ognuna con il numero di valori o righe toccati;
- applica TUTTE le regole del dizionario. In particolare rimuove solo i duplicati di `id_riga`: le righe non
  valide (impression erogate mancanti o negative) restano nel risultato con `impression_erogate` = NaN,
  perché il servizio le esclude dai KPI in un passo successivo;
- converte `data`, `data_inizio_flight`, `data_fine_flight` in datetime64 senza perdere valori (attenzione ai
  formati misti mostrati nel profilo: interpreta sempre il giorno prima del mese);
- converte le colonne numeriche ({numeriche}) in tipi numerici float o int, gestendo il formato valuta
  italiano ("1.234,50 €") senza alterare i valori già numerici scritti con il punto decimale ("16.2");
- normalizza le categorie ai valori canonici: aeroporti {aeroporti}; settori {settori};
- rende `creativita_in_ritardo` booleano.
Puoi usare solo pandas (pd), numpy (np), re, datetime, math. Non leggere né scrivere file.
"""


@dataclass
class CleanedData:
    raw_path: Path
    complete_path: Path  # tutte le righe deduplicate, comprese quelle non valide
    valid_path: Path  # solo righe valide: base di tutte le analisi
    report: list[str]
    code: str
    source: str  # "cache" | "riusata" (codice già validato, dati cambiati) | "generata" (scritta dall'LLM)
    stats: dict


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_profile(raw: pd.DataFrame) -> dict:
    """Profilo generico: non elenca le anomalie, mostra ciò che un analista guarderebbe per primo."""
    profile: dict = {
        "righe": len(raw),
        "colonne": len(raw.columns),
        "righe_con_id_riga_ripetuto": int(raw["id_riga"].duplicated().sum()) if "id_riga" in raw else None,
        "colonne_dettaglio": {},
    }
    for col in raw.columns:
        s = raw[col]
        info: dict = {"dtype": str(s.dtype), "mancanti": int(s.isna().sum()), "distinti": int(s.nunique())}
        if pd.api.types.is_numeric_dtype(s):
            info.update({"min": _num(s.min()), "max": _num(s.max()), "mediana": _num(s.median()),
                         "negativi": int((s < 0).sum())})
        else:
            counts = s.dropna().astype(str).value_counts()
            info["piu_frequenti"] = counts.head(8).index.tolist()
            if len(counts) > 8:
                info["piu_rari"] = counts.tail(8).index.tolist()
            sample = s.dropna().astype(str)
            info["esempi_forme_diverse"] = _shape_examples(sample)
        profile["colonne_dettaglio"][col] = info
    return profile


def _num(v) -> float | None:
    return None if pd.isna(v) else round(float(v), 3)


def _shape_examples(sample: pd.Series, per_shape: int = 2) -> dict[str, list[str]]:
    """Raggruppa i valori per 'forma' (cifre -> 9, lettere -> a) per far emergere formati incoerenti."""
    shapes = sample.str.replace(r"[0-9]", "9", regex=True).str.replace(r"[^\W\d_]", "a", regex=True)
    examples: dict[str, list[str]] = {}
    for shape, value in zip(shapes, sample):
        bucket = examples.setdefault(shape, [])
        if len(bucket) < per_shape:
            bucket.append(value)
        if len(examples) > 12:
            break
    return examples if 1 < len(examples) <= 12 else {}


def validate(raw: pd.DataFrame, clean: pd.DataFrame) -> list[str]:
    """Controlli deterministici sul risultato della pulizia. Lista vuota = superati."""
    errors: list[str] = []
    expected_cols = set(raw.columns)
    if missing := expected_cols - set(clean.columns):
        return [f"Colonne mancanti nel risultato: {sorted(missing)}"]
    if clean["id_riga"].duplicated().any():
        errors.append(f"id_riga ancora duplicati: {int(clean['id_riga'].duplicated().sum())}")
    if len(clean) != raw["id_riga"].nunique():
        errors.append(f"Il risultato ha {len(clean)} righe, attese {raw['id_riga'].nunique()} "
                      "(vanno rimossi solo i duplicati di id_riga)")
    for col in ("data", "data_inizio_flight", "data_fine_flight"):
        if not pd.api.types.is_datetime64_any_dtype(clean[col]):
            errors.append(f"`{col}` non è datetime64 (dtype {clean[col].dtype})")
        elif clean[col].isna().any():
            errors.append(f"`{col}` ha {int(clean[col].isna().sum())} date non interpretate (NaT)")
    for col in NUMERIC_COLUMNS:
        if not pd.api.types.is_numeric_dtype(clean[col]):
            errors.append(f"`{col}` non è numerica (dtype {clean[col].dtype})")
    if errors:
        return errors  # i controlli successivi presuppongono tipi corretti
    checks = {
        "aeroporto": AEROPORTI, "settore": SETTORI, "segmento_audience": SEGMENTI, "formato": FORMATI,
    }
    for col, allowed in checks.items():
        bad = set(clean[col].dropna().unique()) - allowed
        if bad or clean[col].isna().any():
            errors.append(f"`{col}` contiene valori non canonici o mancanti: {sorted(map(str, bad))[:8]}")
    if not pd.api.types.is_bool_dtype(clean["creativita_in_ritardo"]):
        errors.append(f"`creativita_in_ritardo` non è booleana (dtype {clean['creativita_in_ritardo'].dtype})")
    if (clean["impression_erogate"] < 0).any():
        errors.append("ci sono ancora impression_erogate negative")
    raw_bad = pd.to_numeric(raw.drop_duplicates("id_riga")["impression_erogate"], errors="coerce")
    expected_invalid = int((raw_bad.isna() | (raw_bad < 0)).sum())
    if int(clean["impression_erogate"].isna().sum()) != expected_invalid:
        errors.append(f"le righe non valide (impression mancanti o negative) dovrebbero essere {expected_invalid} "
                      f"con impression_erogate = NaN, trovate {int(clean['impression_erogate'].isna().sum())}")
    valid = clean[clean["impression_erogate"].notna()]
    if valid["spesa_eur"].isna().any():
        errors.append(f"spesa_eur mancante su {int(valid['spesa_eur'].isna().sum())} righe valide (va ricalcolata)")
    both = clean[["scansioni_qr", "impression_erogate"]].dropna()
    if (both["scansioni_qr"] > both["impression_erogate"]).any():
        errors.append("ci sono ancora scansioni_qr superiori alle impression")
    dwell = clean["dwell_medio_sec"].dropna()
    if not dwell.between(1, 1800).all():
        errors.append("dwell_medio_sec fuori dall'intervallo 1-1800")
    ratio = (clean["cpm_contrattuale"] / clean["cpm_listino"]).dropna()
    if not ratio.between(0.5, 1.0001).all():
        errors.append("cpm_contrattuale non plausibile rispetto al listino (verifica la conversione del formato valuta)")
    return errors


def _extract_code(text: str) -> str:
    match = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.S)
    return (match.group(1) if match else text).strip()


def _message_text(msg) -> str:
    content = msg.content
    if isinstance(content, list):
        return "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    return str(content)


def _run_cleaning(code: str, raw: pd.DataFrame, raw_path: Path, settings: Settings):
    """Esegue `pulisci` nella sandbox e verifica il risultato. Restituisce (df_pulito, report, problemi)."""
    with Sandbox({"df_grezzo": raw_path}, settings.charts_dir, exec_timeout_s=60) as box:
        result = box.run(code + "\n_df_pulito, _report = pulisci(df_grezzo.copy())\n")
        if not result.ok:
            return None, [], [f"Errore in esecuzione: {result.error}"]
        clean, report = box.get_frame("_df_pulito", "_report")
    if clean is None:
        return None, [], ["pulisci() non ha restituito un DataFrame"]
    return clean, [str(r) for r in (report or [])], validate(raw, clean)


def prepare_clean_data(settings: Settings, force: bool = False, llm=None) -> CleanedData:
    """Prepara il dataset pulito.

    1. dati e dizionario invariati -> cache (nessun calcolo);
    2. dati cambiati ma dizionario invariato -> riusa il codice già validato, se supera ancora i controlli;
    3. altrimenti (o con force=True) l'LLM scrive un nuovo `pulisci`, con fino a N tentativi verificati.
    """
    cache = settings.cache_dir
    cache.mkdir(parents=True, exist_ok=True)
    settings.charts_dir.mkdir(parents=True, exist_ok=True)
    meta_path = cache / "pulizia.json"
    raw_path, complete_path, valid_path = cache / "df_grezzo.pkl", cache / "df_completo.pkl", cache / "df.pkl"
    key = {"csv_sha256": _sha256(settings.data_csv_path), "dizionario_sha256": _sha256(settings.data_dictionary_path)}
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    if not force and valid_path.exists() and all(meta.get(k) == v for k, v in key.items()):
        log.info("pulizia: riuso il risultato in cache (%s)", meta["created_at"])
        return CleanedData(raw_path, complete_path, valid_path, meta["report"], meta["code"], "cache", meta["stats"])

    raw = pd.read_csv(settings.data_csv_path)
    with open(raw_path, "wb") as fh:
        pickle.dump(raw, fh)

    def save(clean: pd.DataFrame, report: list[str], code: str, attempts: int, source: str, model: str) -> CleanedData:
        valid = clean[clean["impression_erogate"].notna()].reset_index(drop=True)
        for path, frame in ((complete_path, clean), (valid_path, valid)):
            tmp = path.with_suffix(".tmp")
            with open(tmp, "wb") as fh:
                pickle.dump(frame, fh)
            tmp.replace(path)  # scrittura atomica: un'analisi in corso non legge mai un file a metà
        stats = {"righe_grezze": len(raw), "righe_dopo_deduplica": len(clean), "righe_valide": len(valid),
                 "tentativi": attempts}
        new_meta = {**key, "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "model": model, "source": source,
                    "code": code, "report": report, "stats": stats}
        meta_path.write_text(json.dumps(new_meta, ensure_ascii=False, indent=2), encoding="utf-8")
        (cache / "pulizia_generata.py").write_text(code + "\n", encoding="utf-8")
        return CleanedData(raw_path, complete_path, valid_path, report, code, source, stats)

    if not force and meta.get("code") and meta.get("dizionario_sha256") == key["dizionario_sha256"]:
        clean, report, problems = _run_cleaning(meta["code"], raw, raw_path, settings)
        if not problems:
            log.info("pulizia: dati cambiati, il codice già validato supera ancora i controlli (nessuna chiamata LLM)")
            return save(clean, report, meta["code"], 0, "riusata", meta.get("model", ""))
        log.info("pulizia: il codice precedente non supera più i controlli (%d problemi): rigenero", len(problems))

    llm = llm or build_llm(settings)
    profile = build_profile(raw)
    dizionario = settings.data_dictionary_path.read_text(encoding="utf-8")
    messages = [
        SystemMessage(CLEANING_SYSTEM_PROMPT),
        HumanMessage(CLEANING_TASK.format(
            dizionario=dizionario, profilo=json.dumps(profile, ensure_ascii=False, indent=1),
            numeriche=", ".join(NUMERIC_COLUMNS), aeroporti=sorted(AEROPORTI), settori=sorted(SETTORI),
        )),
    ]
    last_problem = ""
    for attempt in range(1, settings.cleaning_max_attempts + 1):
        t0 = time.monotonic()
        reply = llm.invoke(messages)
        code = _extract_code(_message_text(reply))
        clean, report, problems = _run_cleaning(code, raw, raw_path, settings)
        log.info("pulizia tentativo %d: %d problemi (%.1fs)", attempt, len(problems), time.monotonic() - t0)
        for problem in problems:
            log.info("  problema: %s", problem[:300])
        if not problems:
            return save(clean, report, code, attempt, "generata", getattr(llm, "model_name", settings.llm_model))
        last_problem = "\n".join(f"- {p}" for p in problems)
        messages += [reply, HumanMessage(
            "Il codice non supera i controlli di qualità:\n" + last_problem +
            "\nCorreggi la funzione `pulisci` e restituisci di nuovo l'intero blocco di codice."
        )]
    raise RuntimeError(f"Pulizia non riuscita dopo {settings.cleaning_max_attempts} tentativi:\n{last_problem}")
