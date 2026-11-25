// Dal testo delle pagine del PDF ai chunk da indicizzare. Funzioni pure: testabili senza PDF né rete.
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const FOOTER = /^(Wayfare Media — Handbook commerciale e operativo|Pagina \d+ di \d+)$/;
const TOP_HEADING = /^(\d{1,2})\.\s+(\S.{1,68})$/; // "5. Garanzia di erogazione e make-good"
const SUB_HEADING = /^(\d{1,2})\.(\d{1,2})\s+(\S.{1,68})$/; // "5.2 Calcolo del make-good"

/** Normalizza il testo estratto: Unicode NFKC (niente legature), spazi, piè di pagina rimossi. */
export function cleanPageText(text) {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !FOOTER.test(line));
}

/**
 * Divide il documento in sezioni seguendo la numerazione dei titoli.
 * Un titolo è accettato solo se continua la sequenza (5 -> 6, 5.1 -> 5.2): così un elenco numerato
 * nel testo ("1. Il cliente segnala...") non viene scambiato per una nuova sezione.
 * @param {string[]} pages testo grezzo di ogni pagina (indice 0 = pagina 1)
 */
export function splitIntoSections(pages) {
  const sections = [];
  let current = { id: "0", title: "Introduzione", page: 1, lines: [] };
  let top = 0;
  let sub = 0;
  pages.forEach((pageText, i) => {
    for (const line of cleanPageText(pageText)) {
      const s = SUB_HEADING.exec(line);
      const t = TOP_HEADING.exec(line);
      let heading = null;
      if (s && Number(s[1]) === top && Number(s[2]) === sub + 1 && !line.endsWith(".")) {
        sub += 1;
        heading = { id: `${top}.${sub}`, title: s[3] };
      } else if (t && Number(t[1]) === top + 1 && !line.endsWith(".")) {
        top += 1;
        sub = 0;
        heading = { id: `${top}`, title: t[2] };
      }
      if (heading) {
        if (current.lines.length) sections.push(current);
        current = { ...heading, page: i + 1, lines: [] };
      } else {
        current.lines.push(line);
      }
    }
  });
  if (current.lines.length) sections.push(current);
  return sections.map(({ lines, ...meta }) => ({ ...meta, text: joinLines(lines) }));
}

/** Ricompone le righe spezzate dal PDF in paragrafi leggibili. */
function joinLines(lines) {
  return lines
    .join("\n")
    .replace(/-\n(?=[a-zà-ù])/g, "") // parole spezzate con il trattino a fine riga
    .replace(/([^.:;!?])\n(?=[a-zà-ù0-9(])/g, "$1 ") // a capo dentro una frase
    .trim();
}

/**
 * Crea i chunk: ogni chunk resta dentro la sua sezione e porta un'intestazione di contesto
 * ("Documento › 5.2 Calcolo del make-good") che finisce anche nell'embedding.
 */
export async function buildChunks(sections, { docTitle, chunkSize = 900, chunkOverlap = 150 } = {}) {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });
  const chunks = [];
  for (const section of sections) {
    if (!section.text) continue;
    const parts = await splitter.splitText(section.text);
    parts.forEach((part, j) => {
      const label = section.id === "0" ? section.title : `${section.id} ${section.title}`;
      const metadata = { section_id: section.id, section_title: section.title, part: j };
      if (section.page) metadata.page = section.page; // solo per i PDF
      chunks.push({ text: `${docTitle} › ${label}\n${part}`, metadata });
    });
  }
  return chunks;
}

// --- Documenti Markdown / testo -------------------------------------------------------------

/** Separa il front matter YAML semplice (chiave: "valore") dal corpo del documento. */
export function parseFrontMatter(text) {
  const normalized = text.normalize("NFKC").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!m) return { meta: {}, body: normalized };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([\w-]+):\s*"?(.*?)"?\s*$/.exec(line);
    if (kv) meta[kv[1]] = kv[2];
  }
  return { meta, body: normalized.slice(m[0].length) };
}

const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const NUMBERED = /^(\d+(?:\.\d+)*)\.?\s+(.+)$/;

/**
 * Sezioni di un documento Markdown, delimitate dai titoli. L'id è la numerazione esplicita del titolo
 * ("4.3 Cancellazione" -> "4.3") oppure, se manca, una numerazione automatica gerarchica.
 * `line` è l'indice (da 0) della riga del titolo nel corpo: il visualizzatore la usa per evidenziare.
 */
export function splitMarkdownSections(body) {
  const lines = body.split("\n");
  const headings = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const h = !inFence && MD_HEADING.exec(line);
    if (h) headings.push({ line: i, depth: h[1].length, raw: h[2] });
  });
  const minDepth = Math.min(...headings.map((h) => h.depth));
  const counters = [];
  const sections = [];
  const intro = lines.slice(0, headings[0]?.line ?? lines.length).join("\n").trim();
  if (intro) sections.push({ id: "0", title: "Introduzione", level: 0, line: 0, text: intro });
  headings.forEach((h, k) => {
    const level = h.depth - minDepth + 1;
    const numbered = NUMBERED.exec(h.raw);
    let id;
    let title = h.raw.replace(/[*_`]/g, "");
    if (numbered) {
      id = numbered[1];
      title = numbered[2].replace(/[*_`]/g, "");
      counters.length = 0;
      counters.push(...id.split(".").map(Number));
    } else {
      counters.length = level;
      counters[level - 1] = (counters[level - 1] ?? 0) + 1;
      for (let j = 0; j < level; j++) counters[j] ??= 1;
      id = counters.slice(0, level).join(".");
    }
    const end = headings[k + 1]?.line ?? lines.length;
    sections.push({ id, title, level, line: h.line, text: lines.slice(h.line + 1, end).join("\n").trim() });
  });
  return sections;
}
