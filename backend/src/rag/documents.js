import { randomUUID } from "node:crypto";
// Documenti della knowledge base su disco (cartella KB_DIR): elenco, lettura, modifica, creazione.
// Markdown e testo sono modificabili dall'interfaccia; i PDF si possono indicizzare e consultare.
import { createHash } from "node:crypto";
import { readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

import { parseFrontMatter, splitIntoSections, splitMarkdownSections } from "./chunking.js";
import { HttpError } from "../errors.js";

export const DOC_NAME = /^[A-Za-z0-9][\w.-]{0,80}\.(md|txt|pdf)$/;
export const MAX_DOC_CHARS = 300_000;

export class DocumentError extends HttpError {}

const kindOf = (id) => path.extname(id).slice(1).toLowerCase();

export function slugify(title) {
  return (
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "documento"
  );
}

async function readPdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

/** Trasforma un PDF in un testo con titoli Markdown, così la lettura è uniforme per tutti i formati. */
function pdfToMarkdown(pages) {
  const pageOf = {};
  const body = splitIntoSections(pages)
    .map((s) => {
      pageOf[s.id] = s.page;
      return s.id === "0" ? s.text : `${s.id.includes(".") ? "##" : "#"} ${s.id} ${s.title}\n\n${s.text}`;
    })
    .join("\n\n");
  return { body, pageOf };
}

export function createDocumentStore(kbDir) {
  const resolve = (id) => {
    if (!DOC_NAME.test(id)) throw new DocumentError("Nome di documento non valido.");
    return path.join(kbDir, id); // il nome è validato: nessun separatore di percorso
  };

  return {
    async list() {
      const names = (await readdir(kbDir)).filter((n) => DOC_NAME.test(n)).sort();
      return Promise.all(
        names.map(async (id) => {
          const info = await stat(path.join(kbDir, id));
          const doc = await this.load(id);
          return { id, kind: kindOf(id), editable: kindOf(id) !== "pdf", title: doc.title, size: info.size, updatedAt: info.mtime.toISOString(), sections: doc.sections.length };
        }),
      );
    },

    async load(id) {
      const file = resolve(id);
      const buffer = await readFile(file).catch((err) => {
        if (err.code === "ENOENT") throw new DocumentError("Documento non trovato.", 404);
        throw err;
      });
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      let meta = {};
      let body;
      let pageOf = {};
      if (kindOf(id) === "pdf") {
        ({ body, pageOf } = pdfToMarkdown(await readPdf(buffer)));
      } else {
        ({ meta, body } = parseFrontMatter(buffer.toString("utf8")));
      }
      const sections = splitMarkdownSections(body).map((s) => (pageOf[s.id] ? { ...s, page: pageOf[s.id] } : s));
      const firstHeading = /^#\s+(.+)$/m.exec(body)?.[1];
      const title = meta.title ?? (kindOf(id) === "pdf" || !firstHeading ? path.basename(id, path.extname(id)).replaceAll("_", " ") : firstHeading);
      return { id, kind: kindOf(id), editable: kindOf(id) !== "pdf", title, meta, content: body, sections, sha256 };
    },

    /** Testo completo del file (front matter compreso), per l'editor. */
    async raw(id) {
      if (kindOf(id) === "pdf") throw new DocumentError("I PDF non sono modificabili.");
      return readFile(resolve(id), "utf8");
    },

    /** Salva il testo completo con una scrittura atomica (file temporaneo + rename). */
    async write(id, content, { create = false } = {}) {
      const file = resolve(id);
      if (kindOf(id) === "pdf") throw new DocumentError("I PDF non sono modificabili.");
      if (!content.trim()) throw new DocumentError("Il documento è vuoto.");
      if (content.length > MAX_DOC_CHARS) throw new DocumentError("Documento troppo lungo.");
      const exists = await stat(file).then(() => true, () => false);
      if (create && exists) throw new DocumentError("Esiste già un documento con questo nome.", 409);
      if (!create && !exists) throw new DocumentError("Documento non trovato.", 404);
      const tmp = path.join(kbDir, `.${id}.${randomUUID()}.tmp`); // due salvataggi insieme non condividono il file
      await writeFile(tmp, content.endsWith("\n") ? content : `${content}\n`, "utf8");
      await rename(tmp, file);
    },

    async remove(id) {
      await unlink(resolve(id)).catch((err) => {
        if (err.code === "ENOENT") throw new DocumentError("Documento non trovato.", 404);
        throw err;
      });
    },
  };
}
