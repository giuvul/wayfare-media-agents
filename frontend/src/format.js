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
  cerca_documentazione: { label: "Documentazione aziendale", running: "Consulto l'handbook aziendale…", icon: "doc" },
  analizza_dati: { label: "Analisi dei dati", running: "L'analista dati sta lavorando: pulizia, calcoli e grafici…", icon: "chart" },
};
