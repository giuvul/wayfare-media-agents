import { useEffect, useState } from "react";

import { api } from "../api.js";
import { formatContext, formatDuration, formatPrice } from "../format.js";
import { useCatalogSearch, usePolling } from "../hooks.js";
import { IconAlert, IconCheck, IconSearch } from "./Icons.jsx";
import ModelRow from "./ModelRow.jsx";

const VERDICT = {
  ok: { label: "Adatto a questa macchina", cls: "badge-ok" },
  limite: { label: "Al limite", cls: "badge-warn" },
  insufficiente: { label: "Risorse insufficienti", cls: "badge-bad" },
  non_supportato: { label: "Non supportato", cls: "badge-bad" },
};
const PHASES = {
  preparazione: "Preparazione…",
  download: "Download del modello",
  caricamento: "Caricamento del modello in memoria…",
  indicizzazione: "Indicizzazione della documentazione",
  verifica: "Ricerca di prova…",
};

function Machine({ m }) {
  return (
    <div className="machine">
      <strong>Questa macchina{m.container ? " (container)" : ""}</strong>
      <span>{m.cpus} CPU</span>
      <span>RAM {(m.memTotalMb / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} GB, disponibili {(m.memAvailableMb / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} GB{m.memLimitedByContainer ? " (limite del container)" : ""}</span>
      {m.diskFreeMb != null && <span>Disco libero {Math.round(m.diskFreeMb / 1024)} GB</span>}
      <span>{m.platform}-{m.arch}{m.libc ? ` (${m.libc})` : ""} · runtime ONNX {m.runtimeSupported ? "supportato" : "non supportato"}</span>
    </div>
  );
}

function Job({ job }) {
  if (!job || job.status === "idle") return null;
  if (job.status === "error") return <p className="notice notice-error">{job.error}</p>;
  if (job.status === "done") {
    const r = job.result;
    return (
      <p className="notice notice-ok">
        <IconCheck size={15} /> Modello attivo: {r.chunks} passaggi indicizzati in {formatDuration(r.durationMs)}
        {r.msPerChunk != null && ` (${r.msPerChunk} ms per passaggio)`}. Ricerca di prova riuscita; soglia di pertinenza
        calibrata a {r.threshold.toLocaleString("it-IT")} (le domande fuori tema arrivano al massimo a {r.offTopicMax.toLocaleString("it-IT")}).
      </p>
    );
  }
  const pct = job.progress == null ? null : Math.round(job.progress * 100);
  return (
    <div className="notice notice-info job">
      <span className="spinner spinner-sm" />
      <div className="job-body">
        <span>{PHASES[job.phase] ?? "In corso…"}{pct != null && ` · ${pct}%`} <span className="muted">→ {job.target?.name}</span></span>
        {pct != null && <div className="bar"><div style={{ width: `${pct}%` }} /></div>}
      </div>
    </div>
  );
}

function RemoteList({ current, busy, onPick }) {
  const [q, setQ] = useState("");
  const { result, error } = useCatalogSearch(api.embeddingModels, q);
  return (
    <>
      <label className="search">
        <IconSearch size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca un modello di embedding (es. multilingual, bge, qwen)…" aria-label="Cerca un modello di embedding" />
      </label>
      <p className="muted small">Catalogo di OpenRouter{result ? ` (${result.total} modelli)` : ""}. Prezzo in dollari per milione di token in input.</p>
      {error && <p className="notice notice-error">{error}</p>}
      <ul className="model-list">
        {result?.models.map((m) => (
          <ModelRow key={m.id} name={m.name} id={m.id} disabled={busy}
            inUse={current.provider === "openrouter" && current.model === m.id}
            meta={[formatPrice(m.promptPrice), `${formatContext(m.contextLength)} contesto`]}
            onUse={() => onPick("openrouter", m.id)} />
        ))}
        {result?.models.length === 0 && <li className="muted">Nessun modello trovato.</li>}
      </ul>
    </>
  );
}

function LocalList({ current, busy, onPick, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.localEmbeddings().then(setData).catch((e) => setError(e.message));
  }, [refreshKey]);
  if (error) return <p className="notice notice-error">{error}</p>;
  if (!data) return <p className="muted small">Verifica delle risorse della macchina…</p>;
  return (
    <>
      <Machine m={data.machine} />
      <ul className="local-models">
        {data.models.map((m) => {
          const inUse = current.provider === "local" && current.model === m.id;
          const v = VERDICT[m.assessment.verdict];
          const blocked = m.assessment.verdict === "insufficiente" || m.assessment.verdict === "non_supportato";
          return (
            <li key={m.id} className={inUse ? "is-current" : ""}>
              <div className="local-head">
                <div>
                  <strong>{m.name}</strong> <code>{m.id}</code>
                  <div className="muted small">{m.description} {m.dims} dimensioni · licenza {m.license} · {m.downloadMb} MB</div>
                </div>
                <span className={`badge ${v.cls}`}>{v.label}</span>
                {inUse ? <span className="badge badge-ok">In uso</span> : (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy || blocked} onClick={() => onPick("local", m.id)}>
                    {m.downloaded ? "Attiva" : "Scarica e attiva"}
                  </button>
                )}
              </div>
              <ul className="reasons">{m.assessment.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const isRunning = (r) => r.job.status === "running";

export default function EmbeddingCard() {
  const { data: info, error: loadError, reload } = usePolling(api.embeddings, isRunning, 1000);
  const [chosenTab, setTab] = useState(null);
  const [actionError, setError] = useState(null);
  const tab = chosenTab ?? info?.current.provider ?? null; // finché non si sceglie, la scheda del modello in uso
  const error = actionError ?? loadError;

  const pick = async (provider, model) => {
    const label = provider === "local" ? "Il modello viene scaricato (se serve) ed eseguito su questo server." : "I testi verranno inviati a OpenRouter per calcolare i vettori.";
    if (!window.confirm(`Passare a ${model}? ${label} La documentazione viene reindicizzata; fino al termine la ricerca usa il modello attuale.`)) return;
    try {
      setError(null);
      await api.switchEmbedding(provider, model);
      reload();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!info) return <section className="card pad">{error ? <p className="notice notice-error">{error}</p> : <p className="muted">Caricamento…</p>}</section>;
  const { current, job } = info;
  const busy = job.status === "running";
  return (
    <section className="card pad stack">
      <h2 className="card-title">Modello di embedding</h2>
      <div className="kv">
        <span>In uso</span>
        <strong>
          <code>{current.model}</code> · {current.provider === "local" ? "locale, su questo server" : "OpenRouter (cloud)"} · {current.source === "ui" ? "scelto da qui" : "dal file .env"}
        </strong>
        <span>Indice</span>
        <strong><code>{current.collection}</code></strong>
        <span>Soglia di pertinenza</span>
        <strong>
          {current.minSimilarity.toLocaleString("it-IT")} · {current.thresholdSource === "calibrata" ? "calibrata su domande fuori tema" : "dal file .env"}
        </strong>
      </div>
      <p className="muted small">
        Trasforma documenti e domande in vettori per la ricerca nella documentazione. Ogni modello ha un indice separato:
        al cambio la documentazione viene reindicizzata e il nuovo modello diventa attivo solo se la ricerca di prova riesce.
        Ogni modello misura la somiglianza su una scala diversa: la soglia sotto cui un passaggio è scartato viene
        calibrata confrontando il modello con domande fuori tema.
      </p>
      <Job job={job} />
      {error && <p className="notice notice-error">{error}</p>}
      <div className="segmented align-start">
        <button type="button" className={tab === "openrouter" ? "is-on" : ""} aria-pressed={tab === "openrouter"} onClick={() => setTab("openrouter")}>OpenRouter (cloud)</button>
        <button type="button" className={tab === "local" ? "is-on" : ""} aria-pressed={tab === "local"} onClick={() => setTab("local")}>Locale (su questo server)</button>
      </div>
      {tab === "openrouter" && <RemoteList current={current} busy={busy} onPick={pick} />}
      {tab === "local" && (
        <>
          <p className="notice notice-muted small">
            <IconAlert size={15} />
            <span>
              Con un modello locale i documenti e le domande non vengono inviati a nessun servizio esterno per l'indicizzazione
              e la ricerca. Il modello linguistico resta su OpenRouter: i passaggi recuperati (non l'intera documentazione)
              fanno parte del prompt con cui genera la risposta.
            </span>
          </p>
          <LocalList current={current} busy={busy} onPick={pick} refreshKey={job.status} />
        </>
      )}
    </section>
  );
}
