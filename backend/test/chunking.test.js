import assert from "node:assert/strict";
import { test } from "node:test";

import { buildChunks, cleanPageText, splitIntoSections } from "../src/rag/chunking.js";
import { formatPassages } from "../src/tools/knowledgeBase.js";

const pages = [
  "Handbook\nWayfare Media — Handbook commerciale e operativo\nPagina 1 di 2",
  "1. Chi siamo\nTesto introduttivo\n1.1 Missione\nLa nostra missione.\n2. Formati\nElenco:\n1. Il cliente segnala il problema.\n2.1 Gate Screen\nSchermi ai gate.\nPagina 2 di 2",
];

test("rimuove i piè di pagina e normalizza le legature", () => {
  assert.deepEqual(cleanPageText("ﬁne\nPagina 3 di 10"), ["fine"]);
});

test("riconosce le sezioni in sequenza e ignora gli elenchi numerati", () => {
  const ids = splitIntoSections(pages).map((s) => s.id);
  assert.deepEqual(ids, ["0", "1", "1.1", "2", "2.1"]);
  assert.match(splitIntoSections(pages).find((s) => s.id === "2").text, /Il cliente segnala/);
});

test("ogni chunk porta l'intestazione di contesto e i metadati", async () => {
  const chunks = await buildChunks(splitIntoSections(pages), { docTitle: "Handbook" });
  const c = chunks.find((x) => x.metadata.section_id === "2.1");
  assert.ok(c.text.startsWith("Handbook › 2.1 Gate Screen\n"));
  assert.equal(c.metadata.page, 2);
});

test("senza risultati il tool dice di non inventare", () => {
  assert.match(formatPassages([]), /Non rispondere con conoscenze generiche/);
});
