import { useEffect, useState } from "react";

import { api } from "../../api.js";
import { IconEdit } from "../Icons.jsx";
import Markdown from "../Markdown.jsx";
import CleaningBanner from "./CleaningBanner.jsx";
import MarkdownEditor from "./MarkdownEditor.jsx";
import { useCleaningStatus } from "./useCleaningStatus.js";

export default function Dictionary() {
  const [content, setContent] = useState(null);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState({});
  const [changed, setChanged] = useState(false);
  const cleaning = useCleaningStatus();

  useEffect(() => {
    api.dictionary().then((r) => setContent(r.content)).catch((err) => setState({ error: err.message }));
  }, []);

  const save = async (text) => {
    setState({ saving: true });
    try {
      await api.saveDictionary(text);
      setContent(text);
      setEditing(false);
      setState({});
      setChanged(true);
      cleaning.reload(800);
    } catch (err) {
      setState({ error: err.message });
    }
  };

  return (
    <div className="stack">
      <p className="muted small">
        Le regole che l'AI segue quando scrive il codice di pulizia e quando calcola i KPI. Se le modifichi, la pulizia
        viene rigenerata dall'AI e verificata di nuovo dai controlli automatici.
      </p>
      <CleaningBanner cleaning={cleaning} changed={changed} />
      {state.error && <p className="notice notice-error">{state.error}</p>}
      {content !== null && editing && (
        <MarkdownEditor initial={content} saving={state.saving} saveLabel="Salva e aggiorna la pulizia" onSave={save} onCancel={() => setEditing(false)} />
      )}
      {content !== null && !editing && (
        <div className="card">
          <div className="card-toolbar">
            <h2 className="card-title">Dizionario dati</h2>
            <div className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}><IconEdit size={15} /> Modifica</button>
          </div>
          <div className="card-body doc-scroll">
            <Markdown onCite={false} className="prose">{content}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}
