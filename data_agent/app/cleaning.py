"""Pulizia dati autonoma ma verificabile.

Prima di tutto un'analisi deterministica (`quality.py`) scansiona tutte le righe del CSV e trova ogni
anomalia rispetto al dizionario dati, con conteggi ed esempi. L'agente riceve analisi e dizionario e scrive
il codice di pulizia, che gira nella sandbox. Il risultato deve superare due verifiche: i controlli di
business (`validate`) e la stessa analisi di qualità rieseguita sui dati puliti, dove le anomalie
"bloccanti" devono essere sparite. Se non le supera, l'agente riceve gli errori e riprova. Il codice valido, il report e i
DataFrame puliti vengono salvati in cache e riusati da tutte le analisi successive: stessi dati, stessi
numeri a ogni domanda (interprete deterministico).
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import pickle
import re
import time
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from langchain_core.messages import HumanMessage, SystemMessage

from . import safe_pickle
from .config import Settings
from .llm import build_llm
from .quality import Schema, analyze, blocking_problems, numeric, parse_dictionary, residuals
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

## Analisi di qualità del file grezzo (deterministica, su tutte le righe)
Ogni anomalia trovata, con numero di righe, esempi (`id_riga` e valore) e, dove possibile, il valore
canonico proposto. Il tuo codice deve gestirle TUTTE: dopo la pulizia gli stessi controlli vengono
rieseguiti sui dati puliti e quelli con "bloccante": true devono dare zero righe.
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
    quality: dict  # {"grezzo": analisi del file grezzo, "residui": {id anomalia: righe ancora presenti}}


def build_profile(raw: pd.DataFrame, schema: Schema, quality: dict | None = None) -> dict:
    """Ciò che riceve l'LLM: l'analisi di qualità completa e un riepilogo delle colonne."""
    columns = {}
    for col in raw.columns:
        s = raw[col]
        info: dict = {"dtype": str(s.dtype), "distinti": int(s.nunique())}
        kind = schema.columns[col].kind if col in schema.columns else None
        if kind in ("intero", "decimale"):
            nums = numeric(s)
            info.update({"min": _num(nums.min()), "max": _num(nums.max()), "mediana": _num(nums.median())})
        elif s.nunique() <= 12:
            info["valori"] = s.dropna().astype(str).value_counts().head(12).to_dict()
        columns[col] = info
    return {"righe": len(raw), "colonne": len(raw.columns), "qualita": quality or analyze(raw, schema),
            "colonne_dettaglio": columns}


def _num(v) -> float | None:
    return None if pd.isna(v) else round(float(v), 3)


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


def _run_cleaning(code: str, raw: pd.DataFrame, raw_path: Path, settings: Settings, schema: Schema):
    """Esegue `pulisci` nella sandbox e verifica il risultato. Restituisce (df_pulito, report, problemi, analisi)."""
    with Sandbox({"df_grezzo": raw_path}, settings.charts_dir, exec_timeout_s=settings.cleaning_exec_timeout_s) as box:
        result = box.run(code + "\n_df_pulito, _report = pulisci(df_grezzo.copy())\n")
        if not result.ok:
            return None, [], [f"Errore in esecuzione: {result.error}"], None
        clean, report = box.get_frame("_df_pulito", "_report")
    if clean is None:
        return None, [], ["pulisci() non ha restituito un DataFrame"], None
    problems = validate(raw, clean)
    try:
        clean_quality = analyze(clean, schema)  # stessi controlli del grezzo, sui dati puliti
    except Exception as exc:
        return clean, [str(r) for r in (report or [])], [*problems, f"analisi di qualità non eseguibile: {exc}"], None
    problems += [p for p in blocking_problems(clean_quality) if p not in problems]
    return clean, [str(r) for r in (report or [])], problems, clean_quality


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
    # file letti una volta: impronta e contenuto usati vengono dalla stessa lettura (una modifica nel frattempo
    # non finisce in cache sotto l'impronta sbagliata)
    csv_bytes = settings.data_csv_path.read_bytes()
    dictionary_bytes = settings.data_dictionary_path.read_bytes()
    key = {"csv_sha256": hashlib.sha256(csv_bytes).hexdigest(), "dizionario_sha256": hashlib.sha256(dictionary_bytes).hexdigest()}
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    dictionary_text = dictionary_bytes.decode("utf-8")
    schema = parse_dictionary(dictionary_text)

    if not force and valid_path.exists() and all(meta.get(k) == v for k, v in key.items()):
        log.info("pulizia: riuso il risultato in cache (%s)", meta["created_at"])
        if "qualita" not in meta:  # cache creata prima dell'analisi di qualità: la si calcola una volta
            raw = pd.read_csv(io.BytesIO(csv_bytes))
            clean = safe_pickle.load_path(complete_path)
            raw_quality = analyze(raw, schema)
            meta["qualita"] = {"grezzo": raw_quality, "residui": residuals(raw_quality, analyze(clean, schema))}
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return CleanedData(raw_path, complete_path, valid_path, meta["report"], meta["code"], "cache", meta["stats"],
                           meta["qualita"])

    raw = pd.read_csv(io.BytesIO(csv_bytes))
    with open(raw_path, "wb") as fh:
        pickle.dump(raw, fh)
    raw_quality = analyze(raw, schema)
    log.info("analisi di qualità: %d tipi di anomalia su %d righe",
             len(raw_quality["anomalie"]), raw_quality["righe_analizzate"])

    def save(clean: pd.DataFrame, report: list[str], code: str, attempts: int, source: str, model: str,
             clean_quality: dict) -> CleanedData:
        valid = clean[clean["impression_erogate"].notna()].reset_index(drop=True)
        for path, frame in ((complete_path, clean), (valid_path, valid)):
            tmp = path.with_suffix(".tmp")
            with open(tmp, "wb") as fh:
                pickle.dump(frame, fh)
            tmp.replace(path)  # scrittura atomica: un'analisi in corso non legge mai un file a metà
        stats = {"righe_grezze": len(raw), "righe_dopo_deduplica": len(clean), "righe_valide": len(valid),
                 "tentativi": attempts}
        quality = {"grezzo": raw_quality, "residui": residuals(raw_quality, clean_quality)}
        new_meta = {**key, "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "model": model, "source": source,
                    "code": code, "report": report, "stats": stats, "qualita": quality}
        meta_path.write_text(json.dumps(new_meta, ensure_ascii=False, indent=2), encoding="utf-8")
        (cache / "pulizia_generata.py").write_text(code + "\n", encoding="utf-8")
        return CleanedData(raw_path, complete_path, valid_path, report, code, source, stats, quality)

    if not force and meta.get("code") and meta.get("dizionario_sha256") == key["dizionario_sha256"]:
        clean, report, problems, clean_quality = _run_cleaning(meta["code"], raw, raw_path, settings, schema)
        if not problems:
            log.info("pulizia: dati cambiati, il codice già validato supera ancora i controlli (nessuna chiamata LLM)")
            return save(clean, report, meta["code"], 0, "riusata", meta.get("model", ""), clean_quality)
        log.info("pulizia: il codice precedente non supera più i controlli (%d problemi): rigenero", len(problems))

    llm = llm or build_llm(settings)
    profile = build_profile(raw, schema, raw_quality)
    dizionario = dictionary_text
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
        clean, report, problems, clean_quality = _run_cleaning(code, raw, raw_path, settings, schema)
        log.info("pulizia tentativo %d: %d problemi (%.1fs)", attempt, len(problems), time.monotonic() - t0)
        for problem in problems:
            log.info("  problema: %s", problem[:300])
        if not problems:
            return save(clean, report, code, attempt, "generata", getattr(llm, "model_name", settings.llm_model),
                        clean_quality)
        last_problem = "\n".join(f"- {p}" for p in problems)
        messages += [reply, HumanMessage(
            "Il codice non supera i controlli di qualità:\n" + last_problem +
            "\nCorreggi la funzione `pulisci` e restituisci di nuovo l'intero blocco di codice."
        )]
    raise RuntimeError(f"Pulizia non riuscita dopo {settings.cleaning_max_attempts} tentativi:\n{last_problem}")
