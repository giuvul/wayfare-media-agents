import { useEffect, useState } from "react";

import { api } from "../../api.js";
import { formatCell } from "../../format.js";
import { useDebouncedValue } from "../../hooks.js";
import { IconSearch } from "../Icons.jsx";
import CleaningBanner from "./CleaningBanner.jsx";
import { useCleaningStatus } from "./useCleaningStatus.js";

function EditableCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState("idle");
  if (!editing) {
    const start = () => { setDraft(value); setEditing(true); };
    return (
      <td className={`editable${state === "saved" ? " just-saved" : ""}`} title="Clic o Invio per modificare" tabIndex={0} role="button"
        onClick={start} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); start(); } }}>
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
  const query = useDebouncedValue(q.trim(), 300);
  // la pagina vale per una vista e una ricerca: cambiandole si riparte dalla prima
  const [paging, setPaging] = useState({ key: "", page: 1 });
  const pagingKey = `${view}|${query}`;
  const page = paging.key === pagingKey ? paging.page : 1;
  const setPage = (p) => setPaging({ key: pagingKey, page: p });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [changed, setChanged] = useState(false);
  const cleaning = useCleaningStatus();

  useEffect(() => {
    const ctrl = new AbortController();
    api.data({ view, page, page_size: 50, q: query }, ctrl.signal).then(
      (d) => { setData(d); setError(null); },
      (err) => err.name !== "AbortError" && setError(err.message),
    );
    return () => ctrl.abort();
  }, [view, page, query]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const idIdx = data ? data.columns.indexOf("id_riga") : -1;

  const saveCell = async (row, column, value) => {
    await api.updateCell(row[idIdx], column, value);
    setData((d) => ({ ...d, rows: d.rows.map((r) => (r === row ? r.map((v, i) => (d.columns[i] === column ? value : v)) : r)) }));
    setChanged(true);
    cleaning.reload(800);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="segmented">
          <button type="button" className={view === "raw" ? "is-on" : ""} aria-pressed={view === "raw"} onClick={() => setView("raw")}>Dati grezzi (CSV)</button>
          <button type="button" className={view === "clean" ? "is-on" : ""} aria-pressed={view === "clean"} onClick={() => setView("clean")}>Dati puliti</button>
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
                  <tr key={`${pagingKey}-${page}-${ri}`}>
                    {row.map((v, i) => {
                      const col = data.columns[i];
                      if (view === "raw" && idIdx >= 0 && data.editable.includes(col)) {
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
            <button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Precedenti</button>
            <span className="muted small">Pagina {page} di {pages}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Successive ›</button>
          </div>
        </div>
      )}
    </div>
  );
}
