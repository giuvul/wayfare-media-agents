import { useCallback, useEffect, useRef, useState } from "react";

import { fetchHealth, streamChat } from "./api.js";
import Composer from "./components/Composer.jsx";
import Header from "./components/Header.jsx";
import Message from "./components/Message.jsx";
import Welcome from "./components/Welcome.jsx";

const newSession = () => crypto.randomUUID();

export default function App() {
  const [sessionId, setSessionId] = useState(newSession);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const load = () => fetchHealth().then(setHealth).catch(() => setHealth({ status: "down" }));
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const updateLast = useCallback((fn) => {
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);
  }, []);

  const send = useCallback(
    async (text) => {
      const message = text.trim();
      if (!message || busy) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", text: message },
        { id: crypto.randomUUID(), role: "assistant", text: "", steps: [], status: "streaming", startedAt: Date.now() },
      ]);

      const onEvent = (event, data) => {
        if (event === "tool_start") {
          updateLast((m) => ({ ...m, text: "", steps: [...m.steps, { ...data, running: true }] }));
        } else if (event === "tool_end") {
          updateLast((m) => ({ ...m, steps: m.steps.map((s) => (s.id === data.id ? { ...data, running: false } : s)) }));
        } else if (event === "token") {
          updateLast((m) => ({ ...m, text: m.text + data.text }));
        } else if (event === "final") {
          updateLast((m) => ({ ...m, text: data.answer, steps: data.steps, status: "done", durationMs: Date.now() - m.startedAt }));
        } else if (event === "error") {
          updateLast((m) => ({ ...m, status: "error", error: data.message }));
        }
      };

      try {
        await streamChat({ message, sessionId, signal: controller.signal, onEvent });
        updateLast((m) => (m.status === "streaming" ? { ...m, status: "error", error: "La risposta si è interrotta. Riprova." } : m));
      } catch (err) {
        const stopped = controller.signal.aborted;
        updateLast((m) => ({
          ...m,
          status: stopped ? "stopped" : "error",
          error: stopped
            ? "Risposta interrotta."
            : err.name === "TimeoutError"
              ? "Nessuna risposta in tempo utile. Riprova tra poco."
              : err.message || "Impossibile contattare il server.",
        }));
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, sessionId, updateLast],
  );

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(newSession());
  };

  return (
    <div className="app">
      <Header health={health} onReset={reset} canReset={messages.length > 0} />
      <main className="conversation" aria-live="polite">
        {messages.length === 0 ? (
          <Welcome onPick={send} />
        ) : (
          messages.map((m) => <Message key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </main>
      <Composer busy={busy} onSend={send} onStop={() => abortRef.current?.abort()} />
    </div>
  );
}
