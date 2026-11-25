import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChunks, cleanPageText, parseFrontMatter, splitIntoSections, splitMarkdownSections } from "../src/rag/chunking.js";
import { formatPassages } from "../src/tools/knowledgeBase.js";

const pages = [
  "Handbook\nWayfare Media — Handbook commerciale e operativo\nPagina 1 di 2",
  "1. Chi siamo\nTesto introduttivo\n1.1 Missione\nLa nostra missione.\n2. Formati\nElenco:\n1. Il cliente segnala il problema.\n2.1 Gate Screen\nSchermi ai gate.\nPagina 2 di 2",
];

test("PDF: rimuove i piè di pagina e normalizza le legature", () => {
  assert.deepEqual(cleanPageText("ﬁne\nPagina 3 di 10"), ["fine"]);
});

test("PDF: riconosce le sezioni in sequenza e ignora gli elenchi numerati", () => {
  const ids = splitIntoSections(pages).map((s) => s.id);
  assert.deepEqual(ids, ["0", "1", "1.1", "2", "2.1"]);
  assert.match(splitIntoSections(pages).find((s) => s.id === "2").text, /Il cliente segnala/);
});

const md = `---
title: "Handbook di prova"
version: "1.0"
---

# 1. Chi siamo
Testo.

## 1.1 Missione
La missione.

\`\`\`
# non è un titolo
\`\`\`

# Glossario
Termini.

## CPM
Costo per mille.
`;

test("Markdown: front matter, sezioni numerate e numerazione automatica", () => {
  const { meta, body } = parseFrontMatter(md);
  assert.equal(meta.title, "Handbook di prova");
  const sections = splitMarkdownSections(body);
  assert.deepEqual(sections.map((s) => [s.id, s.title, s.level]), [
    ["1", "Chi siamo", 1], ["1.1", "Missione", 2], ["2", "Glossario", 1], ["2.1", "CPM", 2],
  ]);
  assert.equal(body.split("\n")[sections[1].line], "## 1.1 Missione"); // la riga serve al visualizzatore
  assert.match(sections[1].text, /non è un titolo/); // i blocchi di codice non aprono sezioni
});

test("ogni chunk porta l'intestazione di contesto e i metadati", async () => {
  const chunks = await buildChunks(splitIntoSections(pages), { docTitle: "Handbook" });
  const c = chunks.find((x) => x.metadata.section_id === "2.1");
  assert.ok(c.text.startsWith("Handbook › 2.1 Gate Screen\n"));
  const mdChunks = await buildChunks(splitMarkdownSections(parseFrontMatter(md).body), { docTitle: "H" });
  assert.equal(mdChunks.find((x) => x.metadata.section_id === "1.1").metadata.page, undefined);
});

test("il tool dice di non inventare e indica come citare", () => {
  assert.match(formatPassages([]), /Non rispondere con conoscenze generiche/);
  const out = formatPassages([{ docTitle: "H", section: "4.3", sectionTitle: "Cancellazione", page: null, text: "H › 4.3\nPenale 50%." }]);
  assert.match(out, /cita come \[§4\.3\]/);
  assert.doesNotMatch(out, /p\. null/);
});
