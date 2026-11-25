"""Accesso ai dati sorgente per la sezione Knowledge Base: consultazione e modifica controllata.

Il CSV grezzo si legge e si scrive con il modulo `csv` come testo: una modifica tocca solo la cella
indicata e lascia intatto tutto il resto (anche le anomalie volute, che la pulizia deve continuare a
gestire). Le scritture sono atomiche (file temporaneo + rename) e serializzate da un lock.
"""

from __future__ import annotations

import csv
import io
import os
import pickle
import threading
from pathlib import Path
from typing import Any

import pandas as pd

ID_COLUMN = "id_riga"
MAX_DICTIONARY_CHARS = 200_000

_lock = threading.Lock()


class DatasetError(ValueError):
    """Errore di validazione su una richiesta di lettura o modifica."""


def _read_raw(path: Path) -> tuple[list[str], list[list[str]]]:
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        header = next(reader)
        return header, [row for row in reader]


def _atomic_write_text(path: Path, text: str) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text, encoding="utf-8", newline="")
    os.replace(tmp, path)


def _matches(row: list[Any], needle: str) -> bool:
    return any(needle in str(v).lower() for v in row)


def _page(rows: list[list[Any]], page: int, page_size: int) -> tuple[list[list[Any]], int]:
    total = len(rows)
    start = (page - 1) * page_size
    return rows[start:start + page_size], total


def raw_page(path: Path, page: int = 1, page_size: int = 50, q: str = "") -> dict:
    header, rows = _read_raw(path)
    if q:
        rows = [r for r in rows if _matches(r, q.lower())]
    items, total = _page(rows, page, page_size)
    return {"columns": header, "rows": items, "total": total, "page": page, "page_size": page_size,
            "editable": [c for c in header if c != ID_COLUMN]}


def _cell(v: Any) -> Any:
    if v is None or (isinstance(v, float) and pd.isna(v)) or v is pd.NaT:
        return None
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d")
    if hasattr(v, "item"):
        return v.item()
    return v


def clean_page(complete_path: Path, page: int = 1, page_size: int = 50, q: str = "") -> dict:
    """Vista dei dati DOPO la pulizia (tutte le righe deduplicate, con la colonna `valida`)."""
    with open(complete_path, "rb") as fh:  # file scritto dal servizio stesso
        df: pd.DataFrame = pickle.load(fh)
    df = df.assign(valida=df["impression_erogate"].notna())
    if q:
        text = df.astype(str).apply(lambda col: col.str.lower())
        df = df[text.apply(lambda col: col.str.contains(q.lower(), regex=False)).any(axis=1)]
    total = len(df)
    chunk = df.iloc[(page - 1) * page_size:page * page_size]
    rows = [[_cell(v) for v in rec] for rec in chunk.itertuples(index=False)]
    return {"columns": [str(c) for c in df.columns], "rows": rows, "total": total, "page": page,
            "page_size": page_size, "editable": []}


def update_cell(path: Path, row_id: str, column: str, value: str) -> dict:
    if len(value) > 200:
        raise DatasetError("Valore troppo lungo (massimo 200 caratteri).")
    with _lock:
        header, rows = _read_raw(path)
        if column not in header or column == ID_COLUMN:
            raise DatasetError(f"Colonna non modificabile: {column}")
        id_idx, col_idx = header.index(ID_COLUMN), header.index(column)
        matches = [r for r in rows if r[id_idx] == row_id]
        if not matches:
            raise KeyError(row_id)
        old = matches[0][col_idx]
        for r in matches:  # i duplicati di id_riga restano coerenti tra loro
            r[col_idx] = value
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)
        _atomic_write_text(path, buffer.getvalue())
    return {"id_riga": row_id, "column": column, "old": old, "new": value, "rows_updated": len(matches)}


def read_dictionary(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_dictionary(path: Path, content: str) -> None:
    if not content.strip():
        raise DatasetError("Il dizionario non può essere vuoto.")
    if len(content) > MAX_DICTIONARY_CHARS:
        raise DatasetError("Dizionario troppo lungo.")
    with _lock:
        _atomic_write_text(path, content if content.endswith("\n") else content + "\n")
