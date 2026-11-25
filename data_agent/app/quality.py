"""Analisi deterministica della qualità dei dati, su tutte le righe.

Gira prima di ogni pulizia e serve a tre cose:
1. dare all'LLM che scrive il codice di pulizia l'elenco completo delle anomalie, con conteggi ed esempi
   (`id_riga` e valore): anche un errore presente in una sola riga è visibile;
2. mostrare all'utente cosa contiene davvero il file (Knowledge Base > Pulizia dei dati);
3. ricontrollare il risultato: i controlli "bloccanti" rieseguiti sui dati puliti devono dare zero.
   Se il codice di pulizia ignora un tipo di anomalia (anche uno comparso solo dopo una modifica dei dati),
   la pulizia viene rifiutata e rigenerata.

Lo schema (tipi, valori ammessi, intervalli, sinonimi) si legge dal dizionario dati: se il dizionario
cambia, i controlli si adeguano.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

import pandas as pd

MAX_EXAMPLES = 5
MESI = {"gen": 1, "feb": 2, "mar": 3, "apr": 4, "mag": 5, "giu": 6, "lug": 7, "ago": 8, "set": 9, "sett": 9,
        "ott": 10, "nov": 11, "dic": 12}
RE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RE_DMY = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")
RE_TEXT_DATE = re.compile(r"^(\d{1,2})\s+([a-zA-Z]{3,4})\.?\s+(\d{4})$")
RE_PLAIN_NUMBER = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$")
RE_CURRENCY_IT = re.compile(r"^[+-]?\d{1,3}(\.\d{3})*(,\d+)?\s*€?$|^[+-]?\d+(,\d+)?\s*€?$")
TRUE_WORDS = {"true", "vero", "sì", "si", "yes", "y", "1"}
FALSE_WORDS = {"false", "falso", "no", "n", "0"}


# --- Schema dal dizionario dati ----------------------------------------------------------------------

@dataclass
class Column:
    name: str
    kind: str  # testo | data | categoria | intero | decimale | booleano
    allowed: list[str] = field(default_factory=list)
    range: tuple[float, float] | None = None
    fill: str | None = None  # valore con cui il dizionario chiede di etichettare i mancanti


@dataclass
class Schema:
    columns: dict[str, Column]
    synonyms: dict[str, str]  # variante (minuscolo) -> valore canonico


def _kind(text: str) -> str:
    t = text.lower()
    for kind in ("booleano", "categoria", "data", "intero", "decimale"):
        if kind in t:
            return kind
    return "testo"


def _allowed_values(description: str) -> list[str]:
    text = re.sub(r"\*\*|`", "", description).strip().rstrip(".")
    body = text.rsplit(":", 1)[1] if ":" in text else text
    items = [v.strip() for v in body.split(",")]
    if len(items) < 2 or any(not v or len(v) > 40 or re.search(r"[().;]", v) for v in items):
        return []
    return items


def parse_dictionary(markdown: str) -> Schema:
    """Ricava lo schema dalla tabella del dizionario e dalle regole (sinonimi, etichette per i mancanti)."""
    columns: dict[str, Column] = {}
    for line in markdown.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3 or not cells[0].startswith("`"):
            continue
        names = re.findall(r"`([^`]+)`", cells[0])
        kind = _kind(cells[1])
        allowed = _allowed_values(cells[2]) if kind == "categoria" else []
        rng = None
        if m := re.search(r"plausibili[^0-9]*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)", cells[2]):
            rng = (float(m[1].replace(",", ".")), float(m[2].replace(",", ".")))
        for name in names:
            columns[name] = Column(name, kind, allowed, rng)
    synonyms = {a.strip().lower(): b.strip() for a, b in re.findall(r"`([^`]+)`\s*=\s*([\w&' ]+?)(?=[,)\n.]|$)", markdown)}
    for col, label in re.findall(r"`(\w+)`\s+mancante si etichetta\s+\"([^\"]+)\"", markdown):
        if col in columns:
            columns[col].fill = label
            if columns[col].allowed and label not in columns[col].allowed:
                columns[col].allowed.append(label)
    return Schema(columns, synonyms)


# --- Utilità di parsing ------------------------------------------------------------------------------

def parse_date(value) -> tuple[str, date | None]:
    """Classifica una data testuale: (formato, data) con formato iso | gg/mm/aaaa | testuale | non valida."""
    s = str(value).strip()
    try:
        if RE_ISO.match(s):
            return "iso", date.fromisoformat(s)
        if m := RE_DMY.match(s):
            return "gg/mm/aaaa", date(int(m[3]), int(m[2]), int(m[1]))
        if (m := RE_TEXT_DATE.match(s)) and m[2].lower() in MESI:
            return "testuale", date(int(m[3]), MESI[m[2].lower()], int(m[1]))
    except ValueError:
        pass
    return "non valida", None


def parse_number(value) -> tuple[str, float | None]:
    """(formato, numero) con formato numero | valuta_it | non_numerico."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "numero", float(value)
    s = str(value).strip()
    if RE_PLAIN_NUMBER.match(s):
        return "numero", float(s)
    if RE_CURRENCY_IT.match(s) and ("," in s or "€" in s or "." in s):
        return "valuta_it", float(s.replace("€", "").strip().replace(".", "").replace(",", "."))
    return "non_numerico", None


def is_text(s: pd.Series) -> bool:
    """Colonna testuale: object o stringa (pandas 3 usa il tipo `str` per le colonne di testo)."""
    return not (pd.api.types.is_numeric_dtype(s) or pd.api.types.is_datetime64_any_dtype(s) or pd.api.types.is_bool_dtype(s))


def _missing(s: pd.Series) -> pd.Series:
    return s.isna() | (s.astype(str).str.strip() == "") if is_text(s) else s.isna()


def numeric(s: pd.Series) -> pd.Series:
    """Converte una colonna in numeri, accettando anche il formato valuta italiano (gli altri -> NaN)."""
    if pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s):
        return s.astype(float)
    return s.map(lambda v: None if pd.isna(v) else parse_number(v)[1]).astype(float)


def dates(s: pd.Series) -> pd.Series:
    if pd.api.types.is_datetime64_any_dtype(s):
        return s
    return pd.to_datetime(s.map(lambda v: None if pd.isna(v) else parse_date(v)[1]), errors="coerce")


# --- Controlli ---------------------------------------------------------------------------------------

class Report:
    def __init__(self, df: pd.DataFrame) -> None:
        self.df = df
        self.ids = df["id_riga"].astype(str) if "id_riga" in df else pd.Series(df.index.astype(str), index=df.index)
        self.checks: list[dict] = []
        self.performed = 0

    def add(self, cid: str, column: str | None, title: str, mask: pd.Series, *, level: str, blocking: bool,
            values: pd.Series | None = None, breakdown: list[dict] | None = None, rule: str | None = None) -> None:
        """level: correggere (va sistemato) | gestire (il dizionario dice come trattarlo) | info."""
        self.performed += 1
        mask = mask.fillna(False).astype(bool)
        n = int(mask.sum())
        if n == 0:
            return
        shown = values if values is not None else (self.df[column] if column else None)
        examples = [{"id_riga": self.ids[i], "valore": None if shown is None else _jsonable(shown[i])}
                    for i in mask[mask].index[:MAX_EXAMPLES]]
        self.checks.append({"id": cid, "colonna": column, "controllo": title, "righe": n, "livello": level,
                            "bloccante": blocking, "esempi": examples, "dettaglio": breakdown or [], "regola": rule})


def _jsonable(v):
    if v is None or (not isinstance(v, (list, dict, str)) and pd.isna(v)):
        return None
    if isinstance(v, (pd.Timestamp, date)):
        return str(v)[:10]
    if hasattr(v, "item"):
        return v.item()
    return v


def _variants(values: pd.Series, mask: pd.Series, propose) -> list[dict]:
    counts = values[mask].astype(str).value_counts()
    return [{"valore": v, "righe": int(c), "proposta": propose(v)} for v, c in counts.head(15).items()]


def analyze(df: pd.DataFrame, schema: Schema) -> dict:
    """Esegue tutti i controlli. Funziona sia sul file grezzo (testi) sia sui dati puliti (tipi già convertiti)."""
    report = Report(df)
    present = [c for c in schema.columns if c in df.columns]

    report.performed += 1
    missing_cols = [c for c in schema.columns if c not in df.columns]
    if missing_cols:
        report.checks.append({"id": "struttura:colonne_mancanti", "colonna": None, "controllo": "Colonne del dizionario assenti nel file",
                              "righe": len(missing_cols), "livello": "correggere", "bloccante": False,
                              "esempi": [{"id_riga": None, "valore": c} for c in missing_cols], "dettaglio": [], "regola": None})

    # Duplicati: righe identiche ripetute e id_riga ripetuti con contenuto diverso
    if "id_riga" in df:
        repeated = df["id_riga"].duplicated(keep="first")
        identical = df.duplicated(keep="first")
        report.add("id_riga:duplicati_identici", "id_riga", "Righe ripetute identiche (export duplicato)", repeated & identical,
                   level="correggere", blocking=True, rule="1")
        report.add("id_riga:duplicati_diversi", "id_riga", "id_riga ripetuto con contenuto diverso", repeated & ~identical,
                   level="correggere", blocking=True, rule="1")
        df = df[~repeated]  # gli altri controlli guardano una riga per id_riga
        report.df, report.ids = df, report.ids[df.index]

    for name in present:
        col, s = schema.columns[name], df[name]
        miss = _missing(s)
        if col.fill:
            report.add(f"{name}:mancanti", name, f"Valori mancanti (da etichettare \"{col.fill}\")", miss,
                       level="correggere", blocking=True, rule="6")
        else:
            report.add(f"{name}:mancanti", name, "Valori mancanti", miss, level="info", blocking=False)
        text = is_text(s)
        ok = ~miss

        if col.kind == "data" and text:
            kinds = s[ok].map(lambda v: parse_date(v)[0])
            for fmt, level, blocking in (("gg/mm/aaaa", "correggere", True), ("testuale", "correggere", True),
                                         ("non valida", "correggere", True)):
                title = {"gg/mm/aaaa": "Date in formato GG/MM/AAAA (lo standard è AAAA-MM-GG)",
                         "testuale": "Date in forma testuale italiana (es. \"5 mar 2026\")",
                         "non valida": "Date non interpretabili"}[fmt]
                report.add(f"{name}:data_{fmt}", name, title, (kinds == fmt).reindex(s.index, fill_value=False),
                           level=level, blocking=blocking)
        elif col.kind == "data":
            report.performed += 1

        if col.kind in ("intero", "decimale"):
            if text:
                kinds = s[ok].map(lambda v: parse_number(v)[0])
                report.add(f"{name}:valuta_testo", name, "Numeri scritti come testo in formato valuta italiano (\"12,50 €\")",
                           (kinds == "valuta_it").reindex(s.index, fill_value=False), level="correggere", blocking=True)
                report.add(f"{name}:non_numerico", name, "Valori non numerici",
                           (kinds == "non_numerico").reindex(s.index, fill_value=False), level="correggere", blocking=True)
            else:
                report.performed += 2
            nums = numeric(s)
            report.add(f"{name}:negativi", name, "Valori negativi", nums < 0, level="gestire", blocking=True,
                       rule="3" if name == "impression_erogate" else None)
            if col.kind == "intero":
                report.add(f"{name}:decimali", name, "Decimali in una colonna di interi", (nums.notna()) & (nums % 1 != 0),
                           level="info", blocking=False)
            if col.range:
                lo, hi = col.range
                report.add(f"{name}:fuori_intervallo", name, f"Fuori dall'intervallo plausibile {lo:g}-{hi:g}",
                           nums.notna() & ~nums.between(lo, hi), level="gestire", blocking=True, rule="5")

        if col.kind == "categoria" and col.allowed:
            allowed = set(col.allowed)
            by_key = {re.sub(r"\s+", "", a).lower(): a for a in col.allowed}

            def propose(v: str, by_key=by_key) -> str | None:
                key = re.sub(r"\s+", "", v).lower()
                return by_key.get(key) or schema.synonyms.get(v.strip().lower())

            bad = ok & ~s.astype(str).isin(allowed)
            report.add(f"{name}:non_canonici", name, "Valori diversi da quelli canonici del dizionario", bad,
                       level="correggere", blocking=True, breakdown=_variants(s, bad, propose), rule="2")

        if col.kind == "booleano" and not pd.api.types.is_bool_dtype(s):
            def as_bool(v) -> str | None:
                w = str(v).strip().lower()
                return "True" if w in TRUE_WORDS else "False" if w in FALSE_WORDS else None

            bad = ok & ~s.astype(str).isin(["True", "False"])
            report.add(f"{name}:booleani_testuali", name, "Booleani scritti in forme diverse da True/False", bad,
                       level="correggere", blocking=True, breakdown=_variants(s, bad, as_bool))

        if col.kind in ("testo", "categoria") and text:
            spaced = ok & (s.astype(str) != s.astype(str).str.strip())
            report.add(f"{name}:spazi", name, "Spazi iniziali o finali", spaced, level="correggere", blocking=True)

    _cross_checks(report, df)
    return {"righe_analizzate": len(report.df), "controlli_eseguiti": report.performed, "anomalie": report.checks}


def _cross_checks(report: Report, df: pd.DataFrame) -> None:
    cols = set(df.columns)
    n = {c: numeric(df[c]) for c in ("impression_erogate", "impression_pianificate", "scansioni_qr", "conversioni",
                                      "spesa_eur", "cpm_contrattuale", "cpm_listino") if c in cols}
    if {"scansioni_qr", "impression_erogate"} <= cols:
        report.add("scansioni_qr:oltre_impression", "scansioni_qr", "Scansioni QR superiori alle impression erogate",
                   (n["impression_erogate"] >= 0) & (n["scansioni_qr"] > n["impression_erogate"]),
                   level="gestire", blocking=True, rule="5")
    if {"conversioni", "scansioni_qr"} <= cols:
        report.add("conversioni:oltre_scansioni", "conversioni", "Conversioni superiori alle scansioni QR",
                   n["conversioni"] > n["scansioni_qr"], level="info", blocking=False)
    if {"spesa_eur", "impression_erogate", "cpm_contrattuale"} <= cols:
        valid = n["impression_erogate"].notna() & (n["impression_erogate"] >= 0)
        report.add("spesa_eur:da_ricalcolare", "spesa_eur", "Spesa mancante su righe valide (da ricalcolare)",
                   valid & n["spesa_eur"].isna(), level="gestire", blocking=True, rule="4")
        expected = n["impression_erogate"] * n["cpm_contrattuale"] / 1000
        off = (n["spesa_eur"] - expected).abs() > (expected.abs() * 0.01).clip(lower=0.05)
        report.add("spesa_eur:incoerente", "spesa_eur", "Spesa diversa da impression × CPM contrattuale / 1000",
                   valid & n["spesa_eur"].notna() & n["cpm_contrattuale"].notna() & off, level="info", blocking=False)
    if {"cpm_contrattuale", "cpm_listino"} <= cols:
        report.add("cpm_contrattuale:oltre_listino", "cpm_contrattuale", "CPM contrattuale superiore al listino",
                   n["cpm_contrattuale"] > n["cpm_listino"] * 1.0001, level="info", blocking=False)
    if {"data", "data_inizio_flight", "data_fine_flight"} <= cols:
        d, start, end = dates(df["data"]), dates(df["data_inizio_flight"]), dates(df["data_fine_flight"])
        report.add("data_fine_flight:prima_inizio", "data_fine_flight", "Fine del flight precedente all'inizio",
                   end < start, level="info", blocking=False)
        report.add("data:fuori_flight", "data", "Giorno di erogazione fuori dal flight", (d < start) | (d > end),
                   level="info", blocking=False)


def residuals(raw_report: dict, clean_report: dict) -> dict[str, int]:
    """Per ogni anomalia trovata nel grezzo, quante righe la presentano ancora dopo la pulizia."""
    after = {c["id"]: c["righe"] for c in clean_report["anomalie"]}
    return {c["id"]: after.get(c["id"], 0) for c in raw_report["anomalie"]}


def blocking_problems(clean_report: dict) -> list[str]:
    """Anomalie che dopo la pulizia non dovrebbero più esserci: diventano errori da correggere nel codice."""
    problems = []
    for c in clean_report["anomalie"]:
        if c["bloccante"]:
            ids = ", ".join(str(e["id_riga"]) for e in c["esempi"][:3])
            problems.append(f"dopo la pulizia restano {c['righe']} righe con: {c['controllo']} "
                            f"(colonna `{c['colonna']}`, es. id_riga {ids})")
    return problems
