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

export default function Header({ health, onReset, canReset }) {
  const status = statusOf(health);
  return (
    <header className="header">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" />
          <path d="M7 21c5-1 9-5 11-11l2 2c-1 3 0 5 2 6l3-1-1 3c-3 1-6 0-8-2-3 2-6 3-9 3z" />
        </svg>
        <div>
          <div className="brand-name">Wayfare Media</div>
          <div className="brand-sub">Assistente Media Sales &amp; Campaign Performance</div>
        </div>
      </div>
      <div className="header-actions">
        <span className={`status status-${status.tone}`} title={detailsOf(health)}>
          <span className="status-dot" aria-hidden="true" />
          {status.label}
        </span>
        <button type="button" className="btn btn-ghost" onClick={onReset} disabled={!canReset}>
          Nuova conversazione
        </button>
      </div>
    </header>
  );
}
