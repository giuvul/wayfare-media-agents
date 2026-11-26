import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCell, groupByDay } from "../src/format.js";

test("formattazione italiana delle celle", () => {
  assert.equal(formatCell(1234567.891), "1.234.567,89");
  assert.equal(formatCell(true), "sì");
  assert.equal(formatCell("2026-03-01T00:00:00"), "2026-03-01");
  assert.equal(formatCell(null), "—");
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
