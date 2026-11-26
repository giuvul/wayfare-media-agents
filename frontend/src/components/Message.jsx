import { citedSources } from "../citations.js";
import AnalysisCard from "./AnalysisCard.jsx";
import { BrandMark } from "./Brand.jsx";
import Markdown from "./Markdown.jsx";
import ModelInfo from "./ModelInfo.jsx";
import Reasoning from "./Reasoning.jsx";
import Sources from "./Sources.jsx";

export default function Message({ message, onOpenDoc }) {
  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="bubble">{message.text}</div>
      </div>
    );
  }

  const live = message.status === "streaming";
  // le citazioni rimandano al documento da cui è stata recuperata quella sezione
  const { sources, sourceOf } = citedSources(message.text, message.steps);
  const openCitation = (section) => onOpenDoc(sourceOf(section), section);
  const analyses = message.steps.filter(
    (s) => s.tool === "analizza_dati" && !s.running && (s.artifact?.charts?.length || s.artifact?.table?.rows?.length),
  );

  return (
    <div className="msg msg-assistant">
      <div className="avatar" aria-hidden="true"><BrandMark /></div>
      <div className="msg-body">
        <Reasoning message={message} live={live} onOpenDoc={onOpenDoc} />
        {message.text && <Markdown className="answer prose" onCite={openCitation}>{message.text}</Markdown>}
        {message.error && <div className={`notice ${message.status === "stopped" ? "notice-muted" : "notice-error"}`}>{message.error}</div>}
        {/* grafici, dati e fonti compaiono a risposta completa: niente salti del layout durante lo streaming */}
        {!live && analyses.map((step) => <AnalysisCard key={step.id} artifact={step.artifact} />)}
        {!live && sources.length > 0 && <Sources sources={sources} onOpenDoc={onOpenDoc} />}
        {!live && <ModelInfo generations={message.generations} requested={message.requestedModel} retry={Boolean(message.startedAt)} />}
      </div>
    </div>
  );
}
