import { useEffect, useRef, useState } from "react";

import { formatCell, formatDuration, TOOL_LABELS } from "../format.js";
import { IconChart, IconCheck, IconChevron, IconDoc } from "./Icons.jsx";
import Markdown from "./Markdown.jsx";

function Cleaning({ cleaning }) {
  if (!cleaning?.righe_grezze) return null;
  return (
    <details className="sub-details">
      <summary>
        Pulizia dei dati: {formatCell(cleaning.righe_grezze)} righe grezze → {formatCell(cleaning.righe_dopo_deduplica)} dopo
        la deduplica → {formatCell(cleaning.righe_valide)} valide
      </summary>
      <ul className="plain-list">
        {(cleaning.report ?? []).map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </details>
  );
}

function Code({ code }) {
  if (!code?.length) return null;
  return (
    <details className="sub-details">
      <summary>Codice eseguito ({code.length} {code.length === 1 ? "esecuzione" : "esecuzioni"})</summary>
      {code.map((c, i) => (
        <pre key={i} className="code"><code>{c.trim()}</code></pre>
      ))}
    </details>
  );
}

function Step({ step, onOpenDoc }) {
  const meta = TOOL_LABELS[step.tool] ?? { label: step.tool };
  const a = step.artifact;
  const isKb = step.tool === "cerca_documentazione";
  const input = step.args?.query ?? step.args?.task ?? "";
  // il codice va nella scheda dell'analisi solo se c'è un grafico o una tabella; altrimenti resta qui
  const codeHere = !isKb && a && !a.charts?.length && !a.table?.rows?.length;
  return (
    <>
      {step.thought && <Markdown onCite={false} className="thought prose">{step.thought}</Markdown>}
      <div className={`tool-step${step.ok === false ? " is-failed" : ""}`}>
        <div className="tool-head">
          <span className="tool-icon">{isKb ? <IconDoc size={15} /> : <IconChart size={15} />}</span>
          <strong>{meta.label}</strong>
          <span className="tool-meta">
            {step.running ? <span className="spinner spinner-sm" /> : step.ok === false ? "non riuscito · " : ""}
            {!step.running && formatDuration(step.durationMs)}
          </span>
        </div>
        <p className="tool-input">{isKb ? `Ricerca: “${input}”` : input}</p>
        {isKb && a?.sources?.length > 0 && (
          <div className="chips chips-sm">
            {a.sources.map((s) => (
              <button key={`${s.source}-${s.section}`} type="button" className="chip" onClick={() => onOpenDoc(s.source, s.section)}
                title={`Somiglianza ${s.similarity}`}>
                §{s.section} {s.sectionTitle}
              </button>
            ))}
          </div>
        )}
        {isKb && a && !a.sources?.length && <p className="muted small">Nessun passaggio sopra la soglia di pertinenza.</p>}
        {a?.error && <p className="step-error">{a.error}</p>}
        {!isKb && <Cleaning cleaning={a?.cleaning} />}
        {codeHere && <Code code={a.code} />}
      </div>
    </>
  );
}

/** Ragionamento e passaggi dell'agente: aperto durante la generazione, richiudibile e consultabile dopo. */
export default function Reasoning({ message, live, onOpenDoc }) {
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) setOpen(false); // a risposta completata si richiude da solo
    wasLive.current = live;
  }, [live]);

  const { steps } = message;
  if (!live && steps.length === 0) return null;
  const running = steps.find((s) => s.running);
  const liveLabel = running ? TOOL_LABELS[running.tool]?.running : steps.length ? "Preparo la risposta…" : "Sto ragionando sulla richiesta…";
  const summary = live
    ? liveLabel
    : `Ragionamento · ${steps.length} ${steps.length === 1 ? "passaggio" : "passaggi"}${message.durationMs ? ` · ${formatDuration(message.durationMs)}` : ""}`;

  return (
    <div className={`reasoning${open ? " is-open" : ""}`}>
      <button type="button" className="reasoning-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {live ? <span className="spinner spinner-sm" /> : <IconCheck size={15} />}
        <span>{summary}</span>
        <IconChevron size={14} className="chevron" />
      </button>
      {open && (
        <div className="reasoning-body">
          {steps.map((s) => <Step key={s.id} step={s} onOpenDoc={onOpenDoc} />)}
          {live && steps.length > 0 && <p className="muted small live-line">{liveLabel}</p>}
        </div>
      )}
    </div>
  );
}
