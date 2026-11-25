import { useEffect, useRef, useState } from "react";

import { api } from "../api.js";
import { formatContext, formatPrice } from "../format.js";
import { IconAlert, IconCheck, IconSearch } from "./Icons.jsx";

function ApiKeyCard({ settings, onSaved }) {
  const [key, setKey] = useState("");
  const [state, setState] = useState({});
  const k = settings.apiKey;
  const save = async (body) => {
    setState({ saving: true });
    try {
      onSaved(await api.updateSettings(body));
      setKey("");
      setState({ ok: body.resetApiKey ? "Ora si usa la chiave del file .env." : "Chiave verificata e salvata." });
    } catch (err) {
      setState({ error: err.message });
    }
  };
  const credit = k.info?.limit != null ? `$${k.info.usage.toFixed(2)} usati su $${k.info.limit}` : k.info ? `$${(k.info.usage ?? 0).toFixed(2)} usati` : null;
  return (
    <section className="card pad stack">
      <h2 className="card-title">Chiave API OpenRouter</h2>
      <div className="kv">
        <span>In uso</span>
        <strong>
          <code>{k.masked}</code> · {k.source === "ui" ? "impostata da qui" : "dal file .env"}
        </strong>
        <span>Stato</span>
        <strong className={k.valid === false ? "text-bad" : ""}>
          {k.valid === true && <><IconCheck size={15} /> valida{credit ? ` · ${credit}` : ""}</>}
          {k.valid === false && <><IconAlert size={15} /> rifiutata da OpenRouter</>}
          {k.valid === null && "non verificabile (OpenRouter non raggiungibile)"}
        </strong>
      </div>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); save({ apiKey: key }); }}>
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-v1-…" aria-label="Nuova chiave API" />
        <button type="submit" className="btn btn-primary" disabled={!key.trim() || state.saving}>{state.saving ? "Verifica…" : "Verifica e salva"}</button>
      </form>
      {k.source === "ui" && (
        <button type="button" className="btn btn-ghost btn-sm align-start" onClick={() => save({ resetApiKey: true })}>Torna alla chiave del file .env</button>
      )}
      <p className="muted small">
        La chiave viene verificata con OpenRouter prima del salvataggio, resta solo sul server (database locale) e non
        viene mai più mostrata per intero. Vale per l'orchestratore, l'analista dati e la ricerca nella documentazione.
      </p>
      {state.ok && <p className="notice notice-ok">{state.ok}</p>}
      {state.error && <p className="notice notice-error">{state.error}</p>}
    </section>
  );
}

function ModelCard({ settings, onSaved }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState(null);
  const [state, setState] = useState({});
  const timer = useRef(null);
  const current = settings.model;

  useEffect(() => {
    clearTimeout(timer.current);
    const ctrl = new AbortController();
    timer.current = setTimeout(() => {
      api.models(q.trim(), ctrl.signal).then(setResult).catch((err) => err.name !== "AbortError" && setState({ error: err.message }));
    }, 250);
    return () => { clearTimeout(timer.current); ctrl.abort(); };
  }, [q]);

  const choose = async (body, message) => {
    setState({ saving: true });
    try {
      onSaved(await api.updateSettings(body));
      setState({ ok: message });
    } catch (err) {
      setState({ error: err.message });
    }
  };

  return (
    <section className="card pad stack">
      <h2 className="card-title">Modello</h2>
      <div className="kv">
        <span>In uso</span>
        <strong><code>{current.id}</code> · {current.source === "ui" ? "scelto da qui" : "dal file .env"}</strong>
        <span>Riserva</span>
        <strong>{settings.fallbackModels.length ? settings.fallbackModels.map((m) => <code key={m}>{m}</code>) : "nessuno"}</strong>
      </div>
      <label className="search">
        <IconSearch size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca un modello (es. deepseek flash, claude, gpt)…" aria-label="Cerca un modello" />
      </label>
      <p className="muted small">
        Catalogo in tempo reale da OpenRouter{result ? ` (${result.total} modelli)` : ""}: sono elencati solo i modelli con
        tool calling, necessario all'agente. Prezzi in dollari per milione di token (input / output).
      </p>
      <ul className="model-list">
        {result?.models.map((m) => (
          <li key={m.id} className={m.id === current.id ? "is-current" : ""}>
            <div className="model-info">
              <strong>{m.name}</strong>
              <code>{m.id}</code>
            </div>
            <span className="model-meta">{formatPrice(m.promptPrice)} / {formatPrice(m.completionPrice)}</span>
            <span className="model-meta">{formatContext(m.contextLength)} contesto</span>
            {m.id === current.id ? (
              <span className="badge badge-ok">In uso</span>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" disabled={state.saving}
                onClick={() => choose({ model: m.id }, `Da ora l'agente usa ${m.name}.`)}>Usa</button>
            )}
          </li>
        ))}
        {result?.models.length === 0 && <li className="muted">Nessun modello trovato.</li>}
      </ul>
      {current.source === "ui" && (
        <button type="button" className="btn btn-ghost btn-sm align-start" onClick={() => choose({ resetModel: true }, "Ripristinato il modello predefinito.")}>
          Ripristina il predefinito ({current.default})
        </button>
      )}
      {state.ok && <p className="notice notice-ok">{state.ok}</p>}
      {state.error && <p className="notice notice-error">{state.error}</p>}
    </section>
  );
}

export default function Settings({ onChanged }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.settings().then(setSettings).catch((err) => setError(err.message));
  }, []);
  const saved = (s) => {
    setSettings(s);
    onChanged();
  };
  return (
    <div className="page">
      <header className="view-head">
        <h1 className="view-title">Impostazioni</h1>
        <p className="view-sub">Provider e modello usati dall'agente. Le modifiche valgono dal messaggio successivo.</p>
      </header>
      <div className="page-body narrow stack">
        {error && <p className="notice notice-error">{error}</p>}
        {!settings && !error && <p className="muted">Caricamento…</p>}
        {settings && (
          <>
            <ApiKeyCard settings={settings} onSaved={saved} />
            <ModelCard settings={settings} onSaved={saved} />
            <section className="card pad stack">
              <h2 className="card-title">Modello di embedding</h2>
              <p><code>{settings.embeddingModel}</code></p>
              <p className="muted small">
                Si imposta nel file .env (EMBEDDING_MODEL): cambiarlo richiede di reindicizzare la documentazione con
                <code> npm run ingest -- --reset</code>, perché vettori di modelli diversi non sono confrontabili.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
