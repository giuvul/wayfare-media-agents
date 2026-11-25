import { navigate } from "../../router.js";
import Cleaning from "./Cleaning.jsx";
import DataBrowser from "./DataBrowser.jsx";
import Dictionary from "./Dictionary.jsx";
import Documents from "./Documents.jsx";

const TABS = [
  { key: "documenti", label: "Documenti", hint: "Handbook e documenti consultati dalla ricerca (RAG)" },
  { key: "dati", label: "Dati delle campagne", hint: "Il CSV analizzato dall'analista dati" },
  { key: "dizionario", label: "Dizionario dati", hint: "Regole di qualità e di calcolo" },
  { key: "pulizia", label: "Pulizia dei dati", hint: "Codice e report della pulizia automatica" },
];

export default function KnowledgeBase({ route, onChanged }) {
  const tab = TABS.find((t) => t.key === route.tab) ?? TABS[0];
  return (
    <div className="page">
      <header className="view-head">
        <h1 className="view-title">Knowledge Base</h1>
        <p className="view-sub">Tutto ciò a cui l'agente ha accesso: documentazione e dati, consultabili e modificabili.</p>
      </header>
      <div className="page-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === tab.key} title={t.hint}
            className={`tab ${t.key === tab.key ? "tab-active" : ""}`} onClick={() => navigate(`/kb/${t.key}`)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="page-body">
        {tab.key === "documenti" && <Documents selected={route.item} onChanged={onChanged} />}
        {tab.key === "dati" && <DataBrowser />}
        {tab.key === "dizionario" && <Dictionary />}
        {tab.key === "pulizia" && <Cleaning />}
      </div>
    </div>
  );
}
