import { useEffect, useRef, useState } from "react";

import { api } from "../../api.js";
import { formatCell } from "../../format.js";
import { IconSearch } from "../Icons.jsx";
import CleaningBanner from "./CleaningBanner.jsx";
import { useCleaningStatus } from "./useCleaningStatus.js";

function EditableCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState("idle");
  if (!editing) {
    return (
      <td className={`editable${state === "saved" ? " just-saved" : ""}`} title="Clic per modificare" onClick={() => { setDraft(value); setEditing(true); }}>
        {value === "" ? <span className="muted">vuoto</span> : value}
      </td>
    );
  }
  const commit = async () => {
    if (draft === value) return setEditing(false);
    setState("saving");
    try {
      await onSave(draft);
      setState("saved");
      setEditing(false);
    } catch (err) {
      setState("idle");
      window.alert(err.message);
    }
  };
  return (
    <td className="editing">
      <input autoFocus value={draft} maxLength={200} disabled={state === "saving"} onChange={(e) => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
    </td>
  );
}

export default function DataBrowser() {
  const [view, setView] = useState("raw");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [changed, setChanged] = useState(false);
  const cleaning = useCleaningStatus();
  const debounce = useRef(null);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(debounce.current);
  }, [q]);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    api.data({ view, page, page_size: 50, q: query }, ctrl.signal).then(setData).catch((err) => err.name !== "AbortError" && setError(err.message));
    return () => ctrl.abort();
  }, [view, page, query]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const idIdx = data?.columns.indexOf("id_riga") ?? 0;

  const saveCell = async (row, column, value) => {
    await api.updateCell(row[idIdx], column, value);
    setData((d) => ({ ...d, rows: d.rows.map((r) => (r === row ? r.map((v, i) => (d.columns[i] === column ? value : v)) : r)) }));
    setChanged(true);
    setTimeout(cleaning.reload, 800);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="segmented">
          <button type="button" className={view === "raw" ? "is-on" : ""} onClick={() => { setView("raw"); setPage(1); }}>Dati grezzi (CSV)</button>
          <button type="button" className={view === "clean" ? "is-on" : ""} onClick={() => { setView("clean"); setPage(1); }}>Dati puliti</button>
        </div>
        <label className="search">
          <IconSearch size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca (es. MXP, WM-2025-0079, Lusso)…" aria-label="Cerca nei dati" />
        </label>
        <div className="spacer" />
        {data && <span className="muted small">{formatCell(data.total)} righe</span>}
      </div>
      <p className="muted small">
        {view === "raw"
          ? "Il file così come arriva dal gestionale, anomalie comprese. Clic su una cella per correggerla: la pulizia si aggiorna da sola."
          : "Il risultato della pulizia automatica, usato dall'analista. Le righe non valide (impression mancanti o negative) restano visibili ma sono escluse dai KPI."}
      </p>
      <CleaningBanner cleaning={cleaning} changed={changed} />
      {error && <p className="notice notice-error">{error}</p>}
      {data && (
        <div className="card">
          <div className="table-wrap table-tall">
            <table>
              <thead>
                <tr>{data.columns.map((c) => <th key={c}>{c.replaceAll("_", " ")}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((row, ri) => (
                  // il CSV grezzo contiene duplicati di id_riga (anomalia voluta): la chiave usa la posizione
                  <tr key={`${view}-${page}-${ri}`}>
                    {row.map((v, i) => {
                      const col = data.columns[i];
                      if (view === "raw" && data.editable.includes(col)) {
                        return <EditableCell key={col} value={v} onSave={(nv) => saveCell(row, col, nv)} />;
                      }
                      if (col === "valida") return <td key={col}><span className={`badge ${v ? "badge-ok" : "badge-bad"}`}>{v ? "sì" : "no"}</span></td>;
                      return <td key={col} className={typeof v === "number" ? "num" : undefined}>{formatCell(v)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Precedenti</button>
            <span className="muted small">Pagina {page} di {pages}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Successive ›</button>
          </div>
        </div>
      )}
    </div>
  );
}
