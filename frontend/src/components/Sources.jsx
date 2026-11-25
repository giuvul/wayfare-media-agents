import { useState } from "react";

export default function Sources({ sources }) {
  const unique = [...new Map(sources.map((s) => [s.section, s])).values()].sort((a, b) =>
    a.section.localeCompare(b.section, "it", { numeric: true }),
  );
  const [open, setOpen] = useState(null);
  const current = unique.find((s) => s.section === open);

  return (
    <section className="sources" aria-label="Fonti consultate">
      <span className="sources-label">Fonti dall'handbook</span>
      <div className="chips">
        {unique.map((s) => (
          <button
            key={s.section}
            type="button"
            className={`chip ${open === s.section ? "chip-active" : ""}`}
            aria-expanded={open === s.section}
            onClick={() => setOpen(open === s.section ? null : s.section)}
          >
            §{s.section} {s.sectionTitle} · p. {s.page}
          </button>
        ))}
      </div>
      {current && (
        <blockquote className="excerpt">
          {current.excerpt}
          {current.excerpt.length >= 400 ? "…" : ""}
        </blockquote>
      )}
    </section>
  );
}
