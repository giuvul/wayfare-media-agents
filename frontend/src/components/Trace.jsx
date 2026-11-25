import { formatCell, formatDuration, TOOL_LABELS } from "../format.js";

function Cleaning({ cleaning }) {
  if (!cleaning?.righe_grezze) return null;
  return (
    <details className="cleaning">
      <summary>
        Pulizia dei dati: {formatCell(cleaning.righe_grezze)} righe grezze → {formatCell(cleaning.righe_dopo_deduplica)} dopo
        la deduplica → {formatCell(cleaning.righe_valide)} valide
      </summary>
      <ul>
        {(cleaning.report ?? []).map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </details>
  );
}

export default function Trace({ steps, durationMs }) {
  return (
    <details className="trace">
      <summary>
        Come ho risposto · {steps.length} {steps.length === 1 ? "passaggio" : "passaggi"}
        {durationMs ? ` · ${formatDuration(durationMs)}` : ""}
      </summary>
      <ol>
        {steps.map((s) => {
          const meta = TOOL_LABELS[s.tool] ?? { label: s.tool };
          const input = s.args?.query ?? s.args?.task ?? JSON.stringify(s.args);
          return (
            <li key={s.id} className={s.ok === false ? "step-failed" : undefined}>
              <div className="step-head">
                <strong>{meta.label}</strong>
                <span className="step-meta">
                  {s.ok === false ? "non riuscito · " : ""}
                  {formatDuration(s.durationMs)}
                </span>
              </div>
              <p className="step-input">{s.tool === "cerca_documentazione" ? `Ricerca: “${input}”` : `Compito per l'analista: ${input}`}</p>
              {s.artifact?.error && <p className="step-error">{s.artifact.error}</p>}
              {s.tool === "analizza_dati" && <Cleaning cleaning={s.artifact?.cleaning} />}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
