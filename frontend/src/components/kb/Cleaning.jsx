import { useState } from "react";

import { api } from "../../api.js";
import { formatCell } from "../../format.js";
import { IconSpark } from "../Icons.jsx";
import QualityTable from "./QualityTable.jsx";
import { describeSource, useCleaningStatus } from "./useCleaningStatus.js";

export default function Cleaning() {
  const { status, busy, reload } = useCleaningStatus();
  const [error, setError] = useState(null);

  const regenerate = async () => {
    if (!window.confirm("Rigenerare la pulizia con l'AI? Servono alcune chiamate al modello; finché non termina le analisi usano la versione attuale.")) return;
    try {
      setError(null);
      await api.rebuildCleaning("regenerate");
      reload(500);
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
      {busy && <p className="notice notice-info"><span className="spinner spinner-sm" /> Pulizia in aggiornamento: le analisi usano la versione precedente fino al termine.</p>}
      {status.error && <p className="notice notice-error">Ultimo aggiornamento non riuscito: {status.error}</p>}
      <QualityTable quality={status.qualita} />
      <div className="card pad">
        <h2 className="card-title">Report dei passi</h2>
        <ol className="plain-list numbered">{status.report.map((r, i) => <li key={i}>{r}</li>)}</ol>
      </div>
      <section className="card">
        <div className="card-toolbar">
          <div>
            <h2 className="card-title">Codice di pulizia</h2>
            <span className="muted small">Scritto dall'AI a partire da dizionario e analisi della qualità, eseguito in sandbox · {describeSource(status.fonte)}</span>
          </div>
          <button type="button" className="btn btn-ghost" onClick={regenerate} disabled={busy}
            title="L'AI riscrive il codice da zero; viene accettato solo se supera i controlli">
            {busy ? <><span className="spinner spinner-sm" /> In corso…</> : <><IconSpark size={15} /> Rigenera con l'AI</>}
          </button>
        </div>
        {error && <p className="notice notice-error pad-x">{error}</p>}
        <div className="card-body">
          <pre className="code code-tall"><code>{status.codice}</code></pre>
        </div>
      </section>
    </div>
  );
}
