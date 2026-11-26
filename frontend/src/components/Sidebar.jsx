import { useState } from "react";

import { groupByDay } from "../format.js";
import { navigate } from "../router.js";
import { BrandMark, Wordmark } from "./Brand.jsx";
import { IconBook, IconChat, IconPlus, IconSettings, IconTrash } from "./Icons.jsx";

function statusOf(health) {
  if (!health) return { tone: "muted", label: "Verifica servizi…" };
  if (health.status === "ok") return { tone: "good", label: "Servizi operativi" };
  if (health.status === "down") return { tone: "bad", label: "Server non raggiungibile" };
  return { tone: "warn", label: "Servizi parziali" };
}

function detailsOf(health) {
  if (!health || health.status === "down") return "";
  const kb = health.knowledgeBase?.ok ? `Knowledge base: ${health.knowledgeBase.chunks} passaggi indicizzati` : "Knowledge base non disponibile";
  const da = health.dataAgent?.ok ? "Analista dati: pronto" : `Analista dati: ${health.dataAgent?.status ?? "non disponibile"}`;
  return `${kb}\n${da}\nModello: ${health.model}`;
}

function HistoryItem({ conversation, active, busy, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <li className="history-item is-confirming">
        <span>Eliminare la conversazione?</span>
        <div className="confirm-actions">
          <button type="button" className="btn btn-danger btn-xs" onClick={() => onDelete(conversation.id)}>Elimina</button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setConfirming(false)}>Annulla</button>
        </div>
      </li>
    );
  }
  return (
    <li className={`history-item${active ? " is-active" : ""}`}>
      <a href={`#/c/${conversation.id}`} title={conversation.title}>
        {busy && <span className="spinner spinner-xs" aria-label="Risposta in corso" />}
        <span className="history-title">{conversation.title}</span>
      </a>
      <button type="button" className="icon-btn history-delete" title="Elimina conversazione" disabled={busy}
        onClick={() => setConfirming(true)}>
        <IconTrash size={15} />
      </button>
    </li>
  );
}

export default function Sidebar({ route, history, busyIds, health, onDelete, open, onClose }) {
  const status = statusOf(health);
  const go = (path) => {
    navigate(path);
    onClose();
  };
  return (
    <>
      {open && <div className="sidebar-scrim" onClick={onClose} aria-hidden="true" />}
      <nav className={`sidebar${open ? " is-open" : ""}`} aria-label="Navigazione">
        <div className="brand">
          <a className="brand-lockup" href="#/" onClick={onClose}>
            <BrandMark />
            <Wordmark />
          </a>
          <div className="brand-sub">Assistente IA per Media Sales &amp; Campaign Performance</div>
        </div>

        <button type="button" className="btn btn-sidebar btn-block" onClick={() => go("/")}>
          <IconPlus size={16} /> Nuova chat
        </button>

        <div className="history" aria-label="Cronologia delle conversazioni">
          {history === null && <p className="muted small pad">Caricamento…</p>}
          {history?.length === 0 && <p className="muted small pad">Le conversazioni salvate compariranno qui.</p>}
          {history &&
            groupByDay(history).map((g) => (
              <div key={g.label} className="history-group">
                <h3>{g.label}</h3>
                <ul onClick={(e) => e.target.closest("a") && onClose()}>
                  {g.items.map((c) => (
                    <HistoryItem key={c.id} conversation={c} active={route.view === "chat" && route.id === c.id}
                      busy={busyIds.has(c.id)} onDelete={onDelete} />
                  ))}
                </ul>
              </div>
            ))}
        </div>

        <div className="sidebar-foot">
          <button type="button" className={`nav-link${route.view === "chat" ? " is-active" : ""}`} onClick={() => go(route.view === "chat" && route.id ? `/c/${route.id}` : "/")}>
            <IconChat size={17} /> Chat
          </button>
          <button type="button" className={`nav-link${route.view === "kb" ? " is-active" : ""}`} onClick={() => go("/kb")}>
            <IconBook size={17} /> Knowledge Base
          </button>
          <button type="button" className={`nav-link${route.view === "settings" ? " is-active" : ""}`} onClick={() => go("/impostazioni")}>
            <IconSettings size={17} /> Impostazioni
          </button>
          <span className={`status status-${status.tone}`} title={detailsOf(health)}>
            <span className="status-dot" aria-hidden="true" />
            {status.label}
            {health?.model && <span className="status-model">{health.model}</span>}
          </span>
        </div>
      </nav>
    </>
  );
}
