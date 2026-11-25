import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { TOOL_LABELS } from "../format.js";
import AnalysisCard from "./AnalysisCard.jsx";
import Sources from "./Sources.jsx";
import Trace from "./Trace.jsx";

const markdownComponents = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
};

function Stage({ message }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const running = [...message.steps].reverse().find((s) => s.running);
  const label = running ? TOOL_LABELS[running.tool]?.running ?? "Uso uno strumento…" : message.steps.length ? "Preparo la risposta…" : "Sto ragionando sulla richiesta…";
  const seconds = Math.floor((now - message.startedAt) / 1000);
  return (
    <div className="stage" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
      {seconds >= 3 && <span className="stage-time">{seconds} s</span>}
    </div>
  );
}

export default function Message({ message }) {
  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="bubble">{message.text}</div>
      </div>
    );
  }

  const analyses = message.steps.filter((s) => s.tool === "analizza_dati" && s.artifact && !s.running);
  const retrieved = message.steps.flatMap((s) => (s.tool === "cerca_documentazione" ? s.artifact?.sources ?? [] : []));
  // si mostrano le sezioni citate nella risposta; se il modello non ha citato, tutte quelle recuperate
  const cited = new Set([...message.text.matchAll(/§\s?(\d+(?:\.\d+)?)/g)].map((m) => m[1]));
  const sources = cited.size ? retrieved.filter((s) => cited.has(s.section)) : retrieved;
  const streaming = message.status === "streaming";

  return (
    <div className="msg msg-assistant">
      <div className="avatar" aria-hidden="true">W</div>
      <div className="msg-body">
        {message.text && (
          <div className="answer">
            <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {message.text}
            </Markdown>
          </div>
        )}
        {streaming && <Stage message={message} />}
        {message.error && <div className={`notice ${message.status === "stopped" ? "notice-muted" : "notice-error"}`}>{message.error}</div>}
        {analyses.map((step) => (
          <AnalysisCard key={step.id} artifact={step.artifact} />
        ))}
        {sources.length > 0 && <Sources sources={sources} />}
        {!streaming && message.steps.length > 0 && <Trace steps={message.steps} durationMs={message.durationMs} />}
      </div>
    </div>
  );
}
