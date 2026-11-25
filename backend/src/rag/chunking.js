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
    const parts = await splitter.splitText(section.text);
    parts.forEach((part, j) => {
      const label = section.id === "0" ? section.title : `${section.id} ${section.title}`;
      chunks.push({
        text: `${docTitle} › ${label}\n${part}`,
        metadata: { section_id: section.id, section_title: section.title, page: section.page, part: j },
      });
    });
  }
  return chunks;
}
