import { useState } from "react";

import { formatCell } from "../format.js";

function DataTable({ table }) {
  const numeric = table.columns.map((_, i) => table.rows.some((r) => typeof r[i] === "number"));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} className={numeric[i] ? "num" : undefined}>
                {c === "index" ? "" : c.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((v, i) => (
                <td key={i} className={numeric[i] ? "num" : undefined}>
                  {formatCell(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.truncated && <p className="table-note">Mostrate le prime {table.rows.length} righe.</p>}
    </div>
  );
}

export default function AnalysisCard({ artifact }) {
  const charts = artifact.charts ?? [];
  const tabs = [
    charts.length > 0 && { key: "chart", label: charts.length > 1 ? `Grafici (${charts.length})` : "Grafico" },
    artifact.table?.rows?.length > 0 && { key: "data", label: "Dati" },
    artifact.code?.length > 0 && { key: "code", label: "Codice" },
  ].filter(Boolean);
  const [active, setActive] = useState(tabs[0]?.key);
  if (tabs.length === 0) return null;

  return (
    <section className="card" aria-label="Risultato dell'analisi">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className={`tab ${active === t.key ? "tab-active" : ""}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="card-body" role="tabpanel">
        {active === "chart" &&
          charts.map((id) => (
            <a key={id} href={`/api/charts/${id}`} target="_blank" rel="noreferrer" title="Apri il grafico a dimensione piena">
              <img className="chart" src={`/api/charts/${id}`} alt="Grafico generato dall'analisi dei dati" loading="lazy" />
            </a>
          ))}
        {active === "data" && <DataTable table={artifact.table} />}
        {active === "code" && (
          <div className="code-list">
            {artifact.code.map((c, i) => (
              <div key={i}>
                <div className="code-label">Esecuzione {i + 1}</div>
                <pre className="code">
                  <code>{c.trim()}</code>
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
