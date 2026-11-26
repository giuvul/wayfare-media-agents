import { useCallback, useEffect, useState } from "react";

import { api } from "../../api.js";
import { formatDate } from "../../format.js";
import { navigate } from "../../router.js";
import DocumentView from "../DocumentView.jsx";
import { IconDoc, IconEdit, IconPlus, IconTrash } from "../Icons.jsx";
import MarkdownEditor from "./MarkdownEditor.jsx";

const TEMPLATE = "# 1. Prima sezione\n\nTesto della sezione.\n\n## 1.1 Sottosezione\n\nDettagli.\n";

function NewDocument({ onCreated, onCancel }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState(TEMPLATE);
  const [state, setState] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    setState({ saving: true });
    try {
      const r = await api.createDocument(title, content);
      onCreated(r);
    } catch (err) {
      setState({ error: err.message });
    }
  };
  return (
    <form className="card pad stack" onSubmit={submit}>
      <h2 className="card-title">Nuovo documento</h2>
      <label className="field">
        <span>Titolo</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Policy creatività 2027" required minLength={3} maxLength={120} />
      </label>
      <label className="field">
        <span>Contenuto (Markdown: usa titoli numerati come "## 2.1 …" perché le citazioni siano precise)</span>
        <textarea className="editor-text" rows={14} value={content} onChange={(e) => setContent(e.target.value)} />
      </label>
      {state.error && <p className="notice notice-error">{state.error}</p>}
      <div className="row-end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Annulla</button>
        <button type="submit" className="btn btn-primary" disabled={state.saving}>{state.saving ? "Creazione e indicizzazione…" : "Crea e indicizza"}</button>
      </div>
    </form>
  );
}

export default function Documents({ selected, onChanged }) {
  const [docs, setDocs] = useState(null);
  const [loaded, setLoaded] = useState({ id: null, doc: null });
  const [modeFor, setModeFor] = useState({ id: null, mode: "view" }); // view | edit | new
  const [raw, setRaw] = useState(null);
  const [state, setState] = useState({});

  const loadList = useCallback(() => api.documents().then((r) => setDocs(r.documents)).catch((err) => setState({ error: err.message })), []);
  useEffect(() => {
    loadList();
  }, [loadList]);

  const current = selected ?? docs?.[0]?.id ?? null;
  // documento e modalità valgono per il documento selezionato: cambiandolo si torna alla lettura
  const doc = loaded.id === current ? loaded.doc : null;
  const mode = modeFor.mode === "new" || modeFor.id === current ? modeFor.mode : "view";
  const setMode = (m) => setModeFor({ id: current, mode: m });
  const setDoc = (d) => setLoaded({ id: current, doc: d });
  useEffect(() => {
    if (!current) return undefined;
    let alive = true; // una risposta arrivata dopo aver cambiato documento viene ignorata
    api.document(current).then(
      (d) => alive && setLoaded({ id: current, doc: d }),
      (err) => alive && setState({ error: err.message }),
    );
    return () => {
      alive = false;
    };
  }, [current]);

  const startEdit = async () => {
    setState({});
    try {
      setRaw((await api.documentRaw(current)).content);
      setMode("edit");
    } catch (err) {
      setState({ error: err.message });
    }
  };

  const save = async (content) => {
    setState({ saving: true });
    try {
      const r = await api.saveDocument(current, content);
      setDoc(await api.document(current));
      setMode("view");
      setState({ ok: r.indexed.skipped ? "Nessuna modifica da indicizzare." : `Salvato e indicizzato: ${r.indexed.chunks} passaggi disponibili per la ricerca.` });
      loadList();
      onChanged();
    } catch (err) {
      setState({ error: err.message });
    }
  };

  const remove = async () => {
    if (!window.confirm(`Eliminare "${doc.title}"? Il documento esce anche dall'indice di ricerca.`)) return;
    try {
      await api.deleteDocument(current);
      setState({ ok: "Documento eliminato." });
      await loadList();
      onChanged();
      navigate("/kb/documenti");
    } catch (err) {
      setState({ error: err.message });
    }
  };

  return (
    <div className="split">
      <aside className="split-list">
        <button type="button" className="btn btn-ghost btn-block" onClick={() => { setMode("new"); setState({}); }}>
          <IconPlus size={16} /> Nuovo documento
        </button>
        {docs === null && <p className="muted small">Caricamento…</p>}
        <ul className="doc-list">
          {docs?.map((d) => (
            <li key={d.id}>
              <a href={`#/kb/documenti/${encodeURIComponent(d.id)}`} className={d.id === current && mode !== "new" ? "is-active" : ""}
                aria-current={d.id === current && mode !== "new" ? "page" : undefined} onClick={() => { setState({}); setModeFor({ id: null, mode: "view" }); }}>
                <IconDoc size={16} />
                <span>
                  <strong>{d.title}</strong>
                  <small>
                    {d.id} · {d.sections} sezioni · {d.chunks == null ? "indice non disponibile" : `${d.chunks} passaggi indicizzati`}
                  </small>
                  <small>Aggiornato il {formatDate(d.updatedAt)}</small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </aside>
      <section className="split-main">
        {state.ok && <p className="notice notice-ok">{state.ok}</p>}
        {state.error && <p className="notice notice-error">{state.error}</p>}
        {mode === "new" && (
          <NewDocument onCancel={() => setMode("view")} onCreated={async (r) => {
            setState({ ok: `Documento creato e indicizzato: ${r.indexed.chunks} passaggi.` });
            await loadList();
            onChanged();
            setModeFor({ id: null, mode: "view" });
            navigate(`/kb/documenti/${encodeURIComponent(r.id)}`);
          }} />
        )}
        {mode === "edit" && raw !== null && (
          <MarkdownEditor initial={raw} saving={state.saving} saveLabel="Salva e reindicizza" onSave={save} onCancel={() => setMode("view")} />
        )}
        {mode === "view" && doc && (
          <div className="card">
            <div className="card-toolbar">
              <div>
                <h2 className="card-title">{doc.title}</h2>
                <span className="muted small">{doc.id} · {doc.sections.length} sezioni</span>
              </div>
              <div className="spacer" />
              {doc.editable && (
                <button type="button" className="btn btn-ghost" onClick={startEdit}><IconEdit size={15} /> Modifica</button>
              )}
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={remove}><IconTrash size={15} /> Elimina</button>
            </div>
            <div className="card-body doc-scroll">
              <DocumentView doc={doc} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
