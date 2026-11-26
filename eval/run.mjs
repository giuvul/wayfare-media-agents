#!/usr/bin/env node
// Valutazione dell'orchestrazione: pone i casi di eval/cases.json all'API del back end, come farebbe l'interfaccia,
// e verifica per ciascuno il percorso degli strumenti, le citazioni, il testo e i numeri attesi.
//
// Uso (con back end, data agent e Chroma avviati):
//   node eval/run.mjs                         # tutti i casi
//   node eval/run.mjs --only mix-make-good    # solo alcuni casi (id separati da virgole)
//   node eval/run.mjs --only mix-make-good --repeat 3   # stabilità di un caso
//   node eval/run.mjs --base http://localhost:3001 --out eval/results
//   node eval/run.mjs --rescore eval/results/<report>.json   # ricalcola i controlli sulle risposte salvate
//
// Scrive un report JSON (ogni turno, con eventi e tempi) e uno Markdown in eval/results/.
// Il controllo "modello effettivo" legge da /api/generations quale modello ha servito ogni chiamata del turno:
// se OpenRouter è passato a un modello di riserva, il caso non è superato (il confronto tra modelli sarebbe falsato).
// Il costo è la differenza del consumo della chiave OpenRouter letto da /api/settings prima e dopo
// (include le chiamate del data agent se usa la stessa chiave): lo script non legge mai la chiave.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3001" },
    only: { type: "string" },
    out: { type: "string", default: join(here, "results") },
    "turn-timeout": { type: "string", default: "180" },
    repeat: { type: "string", default: "1" }, // ripete ogni caso N volte (stabilità delle risposte)
    // ricalcola i controlli di un report esistente (es. dopo aver corretto un controllo), senza interrogare l'agente
    rescore: { type: "string" },
  },
});
const TOOL = { cerca_documentazione: "kb", analizza_dati: "data" };

/** Esegue un turno in streaming SSE e restituisce eventi, passi, risposta, errore e durata. */
async function turn(sessionId, message) {
  const t0 = Date.now();
  const res = await fetch(`${opts.base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, sessionId }),
    signal: AbortSignal.timeout(Number(opts["turn-timeout"]) * 1000),
  });
  if (!res.ok) return { message, error: `HTTP ${res.status}: ${await res.text()}`, steps: [], answer: "", ms: Date.now() - t0 };
  const out = { message, steps: [], answer: "", error: null, firstTokenMs: null };
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for await (const part of res.body) {
      buf += decoder.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (!event || !data) continue;
        const d = JSON.parse(data);
        if (event === "token" && out.firstTokenMs === null) out.firstTokenMs = Date.now() - t0;
        if (event === "tool_end") {
          out.steps.push({
            tool: TOOL[d.tool] ?? d.tool,
            motivo: d.args?.motivo ?? null,
            input: d.args?.query ?? d.args?.task ?? null,
            ok: d.ok,
            ms: d.durationMs,
            sources: d.artifact?.sources?.map((s) => s.section).filter(Boolean),
            charts: d.artifact?.charts?.length ?? 0,
          });
        }
        if (event === "final") {
          out.answer = d.answer;
          out.generations = d.generations ?? null; // id OpenRouter delle chiamate al modello del turno
          out.requestedModel = d.requestedModel ?? null;
        }
        if (event === "error") out.error = d.message;
      }
    }
  } catch (err) {
    out.error = err.name === "TimeoutError" ? "timeout del client" : err.message;
  }
  out.ms = Date.now() - t0;
  return out;
}

const SCALE = { mila: 1e3, milioni: 1e6, milione: 1e6, mln: 1e6, miliardi: 1e9, miliardo: 1e9, mld: 1e9 };

/** Tutte le interpretazioni numeriche dei numeri nel testo: formato italiano e inglese, e "230,6 milioni". */
function numbersIn(text) {
  const found = [];
  for (const [, raw, unit] of text.matchAll(/(\d[\d.,]*\d|\d)(?:\s*(mila|milioni|milione|mln|miliardi|miliardo|mld)\b)?/gi)) {
    const scale = unit ? SCALE[unit.toLowerCase()] : 1;
    found.push(Number(raw.replace(/\./g, "").replace(",", ".")) * scale); // 30.450,54 · 230,6 milioni
    found.push(Number(raw.replace(/,/g, "")) * scale); // 30,450.54
  }
  return found.filter(Number.isFinite);
}

const sameModel = (served, requested) => served === requested || served.startsWith(`${requested}-`);

const routeOf = (steps) => steps.map((s) => s.tool).filter((t, i, a) => t !== a[i - 1]).join(">") || "none";

function check(c, last) {
  const checks = [];
  const route = routeOf(last.steps);
  // un turno finito in errore non ha scelto nessun percorso: non conta come corretto
  checks.push({ name: "percorso", ok: !last.error && c.route.includes(route), detail: `${route} (atteso: ${c.route.join(" | ")})` });
  checks.push({ name: "risposta", ok: !last.error && last.answer.length > 0, detail: last.error ?? "" });
  for (const id of c.cite ?? []) {
    const ok = new RegExp(`§\\s?${id.replace(".", "\\.")}(?!\\d)`).test(last.answer);
    checks.push({ name: `cita §${id}`, ok, detail: "" });
  }
  for (const re of c.contains ?? []) checks.push({ name: `contiene /${re}/`, ok: new RegExp(re, "i").test(last.answer), detail: "" });
  for (const s of c.absent ?? []) checks.push({ name: `non contiene ${s}`, ok: !last.answer.includes(s), detail: "" });
  const nums = numbersIn(last.answer);
  for (const n of c.numbers ?? []) {
    // tolleranza relativa (default 0,5%) o assoluta (`abs`, per percentuali con pochi decimali)
    const { value, tol = 0.005, abs = 0 } = typeof n === "number" ? { value: n } : n;
    const ok = nums.some((x) => Math.abs(x - value) <= Math.max(Math.abs(value) * tol, abs));
    checks.push({ name: `numero ${value}`, ok, detail: "" });
  }
  if (last.served) {
    // modelli che hanno risposto davvero, diversi da quello scelto (fallback di OpenRouter)
    const other = [...new Set(Object.values(last.served).filter(Boolean).map((d) => d.model))].filter(
      (m) => last.requestedModel && !sameModel(m, last.requestedModel),
    );
    checks.push({ name: "modello effettivo", ok: other.length === 0, detail: other.join(", ") });
  }
  if (c.chart) checks.push({ name: "grafico", ok: last.steps.some((s) => s.charts > 0), detail: "" });
  if (c.task) {
    const task = last.steps.filter((s) => s.tool === "data").map((s) => s.input).join(" ");
    checks.push({ name: `compito con /${c.task}/`, ok: new RegExp(c.task, "i").test(task), detail: task.slice(0, 160) });
  }
  return { route, optimal: route === c.route[0], checks, ok: checks.every((k) => k.ok) };
}

async function usage() {
  try {
    const s = await (await fetch(`${opts.base}/api/settings`)).json();
    return { usage: s.apiKey?.info?.usage ?? null, model: s.model?.id ?? null };
  } catch {
    return { usage: null, model: null };
  }
}

const { casi } = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));
const byId = Object.fromEntries(casi.map((c) => [c.id, c]));
const logLine = (c, verdict, ms) => {
  const failed = verdict.checks.filter((k) => !k.ok).map((k) => k.name + (k.detail ? ` [${k.detail}]` : ""));
  console.log(`${verdict.ok ? "OK  " : "FAIL"} ${c.id.padEnd(26)} ${verdict.route.padEnd(9)} ${(ms / 1000).toFixed(1).padStart(6)} s  ${failed.join("; ")}`);
};

let results, date, model, cost, outFile;
if (opts.rescore) {
  // stesse risposte, controlli aggiornati: data, modello e costo restano quelli dell'esecuzione originale
  const saved = JSON.parse(readFileSync(opts.rescore, "utf8"));
  ({ data: date, modello: model, costo_usd: cost } = saved.summary);
  results = saved.results.map((r) => {
    const verdict = check(byId[r.id], r.turns.at(-1));
    logLine(byId[r.id], verdict, r.ms);
    return { ...r, ...verdict };
  });
  outFile = opts.rescore.replace(/\.json$/, "");
} else {
  const only = opts.only?.split(",");
  const selected = (only ? casi.filter((c) => only.includes(c.id)) : casi).flatMap((c) => Array(Number(opts.repeat)).fill(c));
  const before = await usage();
  results = [];
  for (const c of selected) {
    const sessionId = randomUUID();
    const turns = [];
    for (const message of c.turns) turns.push(await turn(sessionId, message));
    const last = turns.at(-1);
    const verdict = check(c, last);
    results.push({ id: c.id, categoria: c.categoria, ...verdict, ms: last.ms, turns });
    logLine(c, verdict, last.ms);
  }
  await new Promise((r) => setTimeout(r, 65_000)); // il consumo letto da /api/settings ha una cache di 60 s
  const after = await usage();
  // dopo l'attesa OpenRouter ha reso disponibili i dettagli delle generazioni: si aggiunge il controllo del modello
  for (const r of results) {
    const last = r.turns.at(-1);
    const ids = [...new Set(Object.values(last.generations ?? {}).flat())];
    if (ids.length === 0) continue;
    last.served = {};
    for (let i = 0; i < ids.length; i += 30) {
      const res = await fetch(`${opts.base}/api/generations?ids=${ids.slice(i, i + 30).join(",")}`).catch(() => null);
      if (res?.ok) Object.assign(last.served, (await res.json()).generations);
    }
    Object.assign(r, check(byId[r.id], last));
  }
  cost = before.usage !== null && after.usage !== null ? Number((after.usage - before.usage).toFixed(4)) : null;
  date = new Date().toISOString();
  model = before.model;
}

const passed = results.filter((r) => r.ok).length;
const routeOk = results.filter((r) => r.checks[0].ok).length;
const optimal = results.filter((r) => r.optimal).length;
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))] / 1000;
const summary = {
  data: date,
  modello: model,
  casi: results.length,
  superati: passed,
  percorso_corretto: routeOk,
  percorso_ottimale: optimal,
  // errori del provider o dell'app (sovraccarico, timeout): disponibilità, non qualità delle risposte
  errori: results.filter((r) => r.turns.at(-1).error).length,
  tempo_mediano_s: pct(0.5),
  tempo_p90_s: pct(0.9),
  costo_usd: cost,
};

const byCat = {};
for (const r of results) {
  byCat[r.categoria] ??= { casi: 0, superati: 0, percorso: 0 };
  byCat[r.categoria].casi++;
  byCat[r.categoria].superati += r.ok ? 1 : 0;
  byCat[r.categoria].percorso += r.checks[0].ok ? 1 : 0;
}
const md = [
  `# Valutazione dell'orchestrazione`,
  ``,
  `- Data: ${summary.data.slice(0, 16).replace("T", " ")} UTC`,
  `- Modello: \`${summary.modello}\``,
  `- Casi superati (tutti i controlli): **${passed}/${results.length}**`,
  `- Percorso degli strumenti corretto: **${routeOk}/${results.length}** (ottimale ${optimal}/${results.length})`,
  `- Turni finiti in errore (provider o app): ${summary.errori}`,
  `- Tempo per risposta: mediana ${summary.tempo_mediano_s.toFixed(1)} s, 90° percentile ${summary.tempo_p90_s.toFixed(1)} s`,
  `- Costo totale: ${cost === null ? "non disponibile" : `${cost.toFixed(4)} USD`}`,
  ...(opts.rescore ? [`- Controlli ricalcolati il ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC sulle risposte salvate`] : []),
  ``,
  `| Categoria | Casi | Percorso corretto | Superati |`,
  `|---|---|---|---|`,
  ...Object.entries(byCat).map(([k, v]) => `| ${k} | ${v.casi} | ${v.percorso} | ${v.superati} |`),
  ``,
  `| Caso | Esito | Percorso | Tempo | Controlli non superati |`,
  `|---|---|---|---|---|`,
  ...results.map((r) => {
    const failed = r.checks.filter((k) => !k.ok).map((k) => k.name + (k.detail ? ` (${k.detail})` : "")).join("; ");
    return `| \`${r.id}\` | ${r.ok ? "superato" : "non superato"} | ${r.route} | ${(r.ms / 1000).toFixed(1)} s | ${failed.replace(/\|/g, "\\|")} |`;
  }),
  ``,
].join("\n");

if (!outFile) {
  mkdirSync(opts.out, { recursive: true });
  outFile = join(opts.out, `${summary.data.slice(0, 16).replace(/[-:T]/g, "")}_${(summary.modello ?? "modello").replace(/[^\w.-]+/g, "-")}`);
}
writeFileSync(`${outFile}.json`, JSON.stringify({ summary, results }, null, 2));
writeFileSync(`${outFile}.md`, md);
console.log(`\n${passed}/${results.length} superati, percorso corretto ${routeOk}/${results.length}, costo ${summary.costo_usd ?? "n.d."} USD`);
console.log(`Report: ${outFile}.{md,json}`);
