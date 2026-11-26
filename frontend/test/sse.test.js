import assert from "node:assert/strict";
import { test } from "node:test";

import { createSseParser } from "../src/sse.js";

test("ricompone eventi spezzati tra più pezzi e ignora i keep-alive", () => {
  const events = [];
  const parse = createSseParser((e, d) => events.push([e, d]));
  parse('event: tool_start\ndata: {"tool":"cerca_');
  parse('documentazione"}\n\n: keep-alive\n\nevent: token\ndata: {"text":"Ciao"}\n\n');
  parse("event: final\r\ndata: {}\r\n\r\n");
  assert.deepEqual(events, [["tool_start", { tool: "cerca_documentazione" }], ["token", { text: "Ciao" }], ["final", {}]]);
});
