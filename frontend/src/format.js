const numberFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

export function formatCell(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return numberFmt.format(value);
  if (typeof value === "boolean") return value ? "sì" : "no";
  if (/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(value)) return value.slice(0, 10);
  return String(value);
}

export function formatDuration(ms) {
  if (ms == null) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString("it-IT", { maximumFractionDigits: 1 })} s`;
}

export const TOOL_LABELS = {
  cerca_documentazione: { label: "Documentazione aziendale", running: "Consulto l'handbook aziendale…" },
  analizza_dati: { label: "Analisi dei dati", running: "L'analista dati sta lavorando: pulizia, calcoli e grafici…" },
};

export function formatDate(iso) {
  return new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Raggruppa le conversazioni per data di ultimo aggiornamento. */
export function groupByDay(conversations, now = new Date()) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const day = 86_400_000;
  const groups = [
    { label: "Oggi", items: [] },
    { label: "Ieri", items: [] },
    { label: "Ultimi 7 giorni", items: [] },
    { label: "Precedenti", items: [] },
  ];
  for (const c of conversations) {
    const t = startOfDay(new Date(c.updatedAt));
    const idx = t >= today ? 0 : t >= today - day ? 1 : t >= today - 7 * day ? 2 : 3;
    groups[idx].items.push(c);
  }
  return groups.filter((g) => g.items.length);
}

export function formatPrice(perMillion) {
  if (perMillion == null) return "—";
  if (perMillion === 0) return "gratis";
  return `$${perMillion.toLocaleString("it-IT", { maximumFractionDigits: 3 })}`;
}

export function formatContext(tokens) {
  if (!tokens) return "—";
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toLocaleString("it-IT", { maximumFractionDigits: 1 })}M` : `${Math.round(tokens / 1000)}K`;
}
