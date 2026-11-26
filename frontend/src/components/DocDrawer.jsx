import { useEffect, useRef, useState } from "react";

import { api } from "../api.js";
import { navigate } from "../router.js";
import DocumentView from "./DocumentView.jsx";
import { IconBook, IconClose, IconExpand, IconShrink } from "./Icons.jsx";

/** Pannello laterale con il documento citato e la sezione evidenziata; si può portare a schermo intero. */
export default function DocDrawer({ target, onClose }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [loaded, setLoaded] = useState({ source: undefined });
  const closeRef = useRef(null);
  // lo stato vale per il documento richiesto: finché non arriva quello giusto si mostra il caricamento
  const state = loaded.source === target.source ? loaded : { loading: true };

  useEffect(() => {
    let alive = true;
    (async () => {
      const id = target.source ?? (await api.documents()).documents[0]?.id;
      if (!id) throw new Error("Nessun documento nella knowledge base.");
      const doc = await api.document(id);
      if (alive) setLoaded({ source: target.source, doc });
    })().catch((err) => alive && setLoaded({ source: target.source, error: err.message }));
    return () => {
      alive = false;
    };
  }, [target.source]);

  // finestra modale: il focus entra nel pannello e, alla chiusura, torna dove era (la citazione cliccata)
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const section = state.doc?.sections.find((s) => s.id === target.section);

  return (
    <>
      {!fullscreen && <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />}
      <aside className={`drawer${fullscreen ? " is-fullscreen" : ""}`} role="dialog" aria-modal="true" aria-label="Documento citato">
        <header className="drawer-head">
          <div className="drawer-title">
            <span className="drawer-kicker">{target.section ? `§${target.section}${section ? ` · ${section.title}` : ""}` : "Documento"}</span>
            <strong>{state.doc?.title ?? "Caricamento…"}</strong>
          </div>
          <div className="drawer-actions">
            {state.doc && (
              <button type="button" className="icon-btn" title="Apri nella Knowledge Base"
                onClick={() => { onClose(); navigate(`/kb/documenti/${encodeURIComponent(state.doc.id)}`); }}>
                <IconBook />
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => setFullscreen((f) => !f)} title={fullscreen ? "Riduci" : "Schermo intero"}>
              {fullscreen ? <IconShrink /> : <IconExpand />}
            </button>
            <button type="button" className="icon-btn" onClick={onClose} title="Chiudi (Esc)" aria-label="Chiudi" ref={closeRef}>
              <IconClose />
            </button>
          </div>
        </header>
        <div className="drawer-body">
          {state.loading && <p className="muted">Caricamento del documento…</p>}
          {state.error && <p className="notice notice-error">{state.error}</p>}
          {state.doc && <DocumentView doc={state.doc} highlight={target.section} />}
        </div>
      </aside>
    </>
  );
}
