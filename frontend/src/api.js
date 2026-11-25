import { createSseParser } from "./sse.js";

export const CLIENT_TIMEOUT_MS = 150_000; // > timeout del back end (120 s): l'errore arriva dal server, con un messaggio chiaro

/** Invia un messaggio e riceve in streaming gli eventi del turno (status, tool_start, tool_end, token, final, error). */
export async function streamChat({ message, sessionId, signal, onEvent }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ message, sessionId }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(CLIENT_TIMEOUT_MS)]),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Errore del server (${res.status}).`);
  }
  const parse = createSseParser(onEvent);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parse(value);
  }
}

export async function fetchHealth() {
  const res = await fetch("/api/health");
  return res.json();
}
