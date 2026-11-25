// Citazioni nel testo delle risposte: "[§4.3]", "[§5.2; §5.3]", "§6.5" diventano link cliccabili
// (#cite-4.3) che il componente Markdown trasforma in pulsanti verso il documento citato.

const GROUP = /\[([^[\]]*?§\s?\d+(?:\.\d+)*[^[\]]*?)\]|§\s?(\d+(?:\.\d+)*)/g;
const ID = /§\s?(\d+(?:\.\d+)*)/g;

const link = (id) => ({ type: "link", url: `#cite-${id}`, children: [{ type: "text", value: `§${id}` }] });

export function splitCitations(value) {
  const out = [];
  let last = 0;
  for (const m of value.matchAll(GROUP)) {
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
    const ids = m[1] ? [...m[1].matchAll(ID)].map((x) => x[1]) : [m[2]];
    ids.forEach((id, i) => {
      if (i > 0) out.push({ type: "text", value: " " });
      out.push(link(id));
    });
    last = m.index + m[0].length;
  }
  if (last === 0) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

/** Plugin remark: sostituisce le citazioni nei nodi di testo (non dentro link o codice). */
export function remarkCitations() {
  const walk = (node) => {
    if (!node.children || node.type === "link" || node.type === "linkReference") return;
    node.children = node.children.flatMap((child) => {
      if (child.type === "text") return splitCitations(child.value) ?? [child];
      walk(child);
      return [child];
    });
  };
  return walk;
}

/**
 * Divide un documento in blocchi, uno per sezione, usando la riga del titolo fornita dal server.
 * Il primo blocco (prima del primo titolo) ha section = null.
 */
export function splitDocumentBlocks(content, sections) {
  const lines = content.split("\n");
  const starts = sections.filter((s) => s.level > 0).sort((a, b) => a.line - b.line);
  const blocks = [];
  const head = lines.slice(0, starts[0]?.line ?? lines.length).join("\n").trim();
  if (head) blocks.push({ section: null, markdown: head });
  starts.forEach((s, i) => {
    const markdown = lines.slice(s.line, starts[i + 1]?.line ?? lines.length).join("\n").trim();
    blocks.push({ section: s, markdown, numbered: lines[s.line].includes(s.id) });
  });
  return blocks;
}

export const isWithin = (sectionId, target) => Boolean(target) && (sectionId === target || sectionId.startsWith(`${target}.`));
