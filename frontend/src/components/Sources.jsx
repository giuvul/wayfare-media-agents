import { useState } from "react";

import { IconBook, IconDoc } from "./Icons.jsx";

export default function Sources({ sources, onOpenDoc }) {
  const unique = [...new Map(sources.map((s) => [`${s.source}#${s.section}`, s])).values()].sort((a, b) =>
    a.section.localeCompare(b.section, "it", { numeric: true }),
  );
  const [open, setOpen] = useState(null);
  const current = unique.find((s) => `${s.source}#${s.section}` === open);

  return (
    <section className="sources" aria-label="Fonti consultate">
      <span className="section-label">Fonti dalla documentazione</span>
      <div className="chips">
        {unique.map((s) => {
          const key = `${s.source}#${s.section}`;
          return (
            <button key={key} type="button" className={`chip ${open === key ? "chip-active" : ""}`} aria-expanded={open === key}
              onClick={() => setOpen(open === key ? null : key)}>
              <IconBook size={14} />
              §{s.section} {s.sectionTitle}{s.page ? ` · p. ${s.page}` : ""}
            </button>
          );
        })}
      </div>
      {current && (
        <div className="excerpt">
          <blockquote>
            {current.excerpt}
            {current.excerpt.length >= 400 ? "…" : ""}
          </blockquote>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenDoc(current.source, current.section)}>
            <IconDoc size={15} /> Visualizza documento
          </button>
        </div>
      )}
    </section>
  );
}
