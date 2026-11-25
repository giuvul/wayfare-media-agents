import { useEffect, useMemo, useRef } from "react";

import { isWithin, splitDocumentBlocks } from "../citations.js";
import Markdown from "./Markdown.jsx";

/** Documento della knowledge base diviso per sezioni; la sezione `highlight` (e le sue sottosezioni) è evidenziata. */
export default function DocumentView({ doc, highlight }) {
  const blocks = useMemo(() => splitDocumentBlocks(doc.content, doc.sections), [doc]);
  const ref = useRef(null);

  useEffect(() => {
    if (!highlight) return;
    const el = ref.current?.querySelector(".doc-block.is-highlighted");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlight, doc]);

  return (
    <article className="doc" ref={ref}>
      {(doc.meta?.subtitle || doc.meta?.version) && (
        <header className="doc-meta">
          {doc.meta.subtitle && <p>{doc.meta.subtitle}</p>}
          {doc.meta.version && <p className="muted">{doc.meta.version}</p>}
        </header>
      )}
      {blocks.map((b, i) => {
        const id = b.section?.id;
        const on = id && isWithin(id, highlight);
        return (
          <section key={id ?? `intro-${i}`} id={id ? `sec-${id}` : undefined} className={`doc-block${on ? " is-highlighted" : ""}`}>
            {b.section && !b.numbered && <span className="sec-badge">§{id}</span>}
            <Markdown onCite={false} className="prose">{b.markdown}</Markdown>
          </section>
        );
      })}
    </article>
  );
}
