import { useState } from "react";

import { api } from "../../api.js";
import { formatCell } from "../../format.js";
import { IconSpark } from "../Icons.jsx";
import { describeSource, useCleaningStatus } from "./useCleaningStatus.js";

export default function Cleaning() {
  const { status, busy, reload } = useCleaningStatus();
  const [error, setError] = useState(null);

  const regenerate = async () => {
    if (!window.confirm("Rigenerare la pulizia con l'AI? Servono alcune chiamate al modello; finché non termina le analisi usano la versione attuale.")) return;
    try {
      setError(null);
      await api.rebuildCleaning("regenerate");
      setTimeout(reload, 500);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!status) return <p className="muted">Caricamento…</p>;
  if (status.error && !status.stats) return <p className="notice notice-error">{status.error}</p>;
  const s = status.stats;
  return (
    <div className="stack">
      <div className="tiles">
        <div className="tile"><span>Righe grezze</span><strong>{formatCell(s.righe_grezze)}</strong></div>
        <div className="tile"><span>Dopo la deduplica</span><strong>{formatCell(s.righe_dopo_deduplica)}</strong></div>
        <div className="tile"><span>Righe valide per i KPI</span><strong>{formatCell(s.righe_valide)}</strong></div>
        <div className="tile"><span>Tentativi dell'AI</span><strong>{s.tentativi === 0 ? "—" : s.tentativi}</strong></div>
      </div>
      <div className="toolbar">
        <p className="muted small">Origine: {describeSource(status.fonte)}.</p>
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={regenerate} disabled={busy}>
          {busy ? <><span className="spinner spinner-sm" /> Aggiornamento in corso…</> : <><IconSpark size={15} /> Rigenera con l'AI</>}
        </button>
      </div>
      {error && <p className="notice notice-error">{error}</p>}
      {status.error && <p className="notice notice-error">Ultimo aggiornamento non riuscito: {status.error}</p>}
      <div className="card pad">
        <h2 className="card-title">Report dei passi</h2>
        <ol className="plain-list numbered">{status.report.map((r, i) => <li key={i}>{r}</li>)}</ol>
      </div>
      <div className="card pad">
        <h2 className="card-title">Codice di pulizia (scritto dall'AI, eseguito in sandbox)</h2>
        <pre className="code code-tall"><code>{status.codice}</code></pre>
      </div>
    </div>
  );
}
