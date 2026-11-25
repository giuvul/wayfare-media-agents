import assert from "node:assert/strict";
import { test } from "node:test";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { isWithin, remarkCitations, splitCitations, splitDocumentBlocks } from "../src/citations.js";
import { groupByDay } from "../src/format.js";

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

test("cronologia raggruppata per giorno", () => {
  const now = new Date("2026-11-25T15:00:00");
  const groups = groupByDay([
    { id: "a", updatedAt: "2026-11-25T09:00:00" },
    { id: "b", updatedAt: "2026-11-24T20:00:00" },
    { id: "c", updatedAt: "2026-11-20T10:00:00" },
    { id: "d", updatedAt: "2026-10-01T10:00:00" },
  ], now);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [["Oggi", ["a"]], ["Ieri", ["b"]], ["Ultimi 7 giorni", ["c"]], ["Precedenti", ["d"]]]);
});
