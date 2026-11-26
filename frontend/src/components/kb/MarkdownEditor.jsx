import { useState } from "react";

import Markdown from "../Markdown.jsx";

/** Editor Markdown con anteprima affiancata (o a schede su schermi stretti). */
export default function MarkdownEditor({ initial, onSave, onCancel, saving, saveLabel = "Salva" }) {
  const [text, setText] = useState(initial);
  const [pane, setPane] = useState("edit");
  const dirty = text !== initial;
  return (
    <div className="editor">
      <div className="editor-toolbar">
        <div className="segmented">
          <button type="button" className={pane === "edit" ? "is-on" : ""} aria-pressed={pane === "edit"} onClick={() => setPane("edit")}>Modifica</button>
          <button type="button" className={pane === "preview" ? "is-on" : ""} aria-pressed={pane === "preview"} onClick={() => setPane("preview")}>Anteprima</button>
        </div>
        <span className="muted small">{dirty ? "Modifiche non salvate" : "Nessuna modifica"}</span>
        <div className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Annulla</button>
        <button type="button" className="btn btn-primary" onClick={() => onSave(text)} disabled={!dirty || saving}>
          {saving ? "Salvataggio…" : saveLabel}
        </button>
      </div>
      <div className={`editor-panes show-${pane}`}>
        <textarea className="editor-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck="true" aria-label="Testo Markdown" />
        <div className="editor-preview">
          <Markdown onCite={false} className="prose">{text.replace(/^---\n[\s\S]*?\n---\n?/, "")}</Markdown>
        </div>
      </div>
    </div>
  );
}
