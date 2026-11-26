import assert from "node:assert/strict";
import { test } from "node:test";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { citedSources, isWithin, remarkCitations, splitCitations, splitDocumentBlocks } from "../src/citations.js";

const links = (nodes) => nodes.filter((n) => n.type === "link").map((n) => n.url);

test("citazioni: singole, multiple, con pagina e senza parentesi", () => {
  assert.deepEqual(links(splitCitations("penale del 50% [§4.3].")), ["#cite-4.3"]);
  assert.deepEqual(links(splitCitations("vedi [§5.2; §5.3] e [§4.3, p. 5]")), ["#cite-5.2", "#cite-5.3", "#cite-4.3"]);
  assert.deepEqual(links(splitCitations("la regola §6.5 dice")), ["#cite-6.5"]);
  assert.equal(splitCitations("nessuna citazione [Fonte 1]"), null);
});

test("plugin remark: sostituisce le citazioni nel testo ma non nel codice", () => {
  const tree = unified().use(remarkParse).parse("Penale del **50%** [§4.3].\n\n`[§9.9]`");
  unified().use(remarkCitations).runSync(tree);
  const urls = [];
  const walk = (n) => { if (n.type === "link") urls.push(n.url); n.children?.forEach(walk); };
  walk(tree);
  assert.deepEqual(urls, ["#cite-4.3"]);
});

test("blocchi del documento ed evidenziazione delle sottosezioni", () => {
  const content = "Intro\n# 1. Uno\nTesto\n## 1.1 Sotto\nAltro\n# Glossario\nX";
  const sections = [{ id: "1", level: 1, line: 1 }, { id: "1.1", level: 2, line: 3 }, { id: "2", level: 1, line: 5 }];
  const blocks = splitDocumentBlocks(content, sections);
  assert.deepEqual(blocks.map((b) => b.section?.id ?? null), [null, "1", "1.1", "2"]);
  assert.equal(blocks[3].numbered, false); // "Glossario" non ha numero: il visualizzatore mostra §2
  assert.ok(isWithin("1.1", "1") && isWithin("1", "1") && !isWithin("11", "1") && !isWithin("1", null));
});

test("fonti di una risposta: solo le sezioni citate, ognuna col documento da cui è stata recuperata", () => {
  const steps = [
    { tool: "cerca_documentazione", artifact: { sources: [
      { source: "handbook", section: "4.3", similarity: 0.8 },
      { source: "policy", section: "4.3", similarity: 0.9 },
      { source: "handbook", section: "5.1", similarity: 0.7 },
    ] } },
    { tool: "analizza_dati", artifact: {} },
  ];
  const { sources, sourceOf } = citedSources("La penale è del 50% [§4.3].", steps);
  assert.deepEqual(sources.map((s) => s.section), ["4.3", "4.3"]);
  assert.equal(sourceOf("4.3"), "policy"); // vince il passaggio più simile
  assert.equal(sourceOf("9.9"), "handbook"); // sezione sconosciuta: il primo documento recuperato
  assert.equal(citedSources("Nessuna citazione.", steps).sources.length, 3); // senza citazioni: tutte le fonti
});
