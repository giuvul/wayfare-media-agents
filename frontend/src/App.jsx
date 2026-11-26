import { useCallback, useEffect, useRef, useState } from "react";

import { api, streamChat } from "./api.js";
import ChatView from "./components/ChatView.jsx";
import DocDrawer from "./components/DocDrawer.jsx";
import { IconMenu } from "./components/Icons.jsx";
import KnowledgeBase from "./components/kb/KnowledgeBase.jsx";
import Settings from "./components/Settings.jsx";
import Sidebar from "./components/Sidebar.jsx";
import { navigate, useRoute } from "./router.js";

const LOADING_THREAD = { messages: [], loading: true };

export default function App() {
  const route = useRoute();
  const [threads, setThreads] = useState({}); // id conversazione -> { messages, loading, error }
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [history, setHistory] = useState(null);
  const [health, setHealth] = useState(null);
  const [docTarget, setDocTarget] = useState(null); // { source, section } del documento aperto nel pannello
  const [menuOpen, setMenuOpen] = useState(false);
  const controllers = useRef(new Map());

  const refreshHistory = useCallback(() => api.conversations().then((r) => setHistory(r.conversations)).catch(() => setHistory([])), []);
  const refreshHealth = useCallback(() => api.health().then(setHealth), []);

  useEffect(() => {
    refreshHistory();
    refreshHealth();
    const timer = setInterval(refreshHealth, 30_000);
    return () => clearInterval(timer);
  }, [refreshHistory, refreshHealth]);

  // apertura di una conversazione salvata: i messaggi arrivano dal server
  const currentId = route.view === "chat" ? route.id : null;
  useEffect(() => {
    if (!currentId || threads[currentId]) return;
    setThreads((t) => ({ ...t, [currentId]: { messages: [], loading: true } }));
    api
      .conversation(currentId)
      .then((c) => setThreads((t) => ({ ...t, [currentId]: { messages: c.messages } })))
      .catch((err) => setThreads((t) => ({ ...t, [currentId]: { messages: [], error: err.message } })));
  }, [currentId, threads]);

  const update = useCallback((id, fn) => {
    setThreads((t) => {
      const msgs = t[id].messages;
      return { ...t, [id]: { ...t[id], messages: [...msgs.slice(0, -1), fn(msgs[msgs.length - 1])] } };
    });
  }, []);

  const send = useCallback(
    async (text) => {
      const message = text.trim();
      let id = currentId;
      if (!message || (id && busyIds.has(id))) return;
      if (!id) {
        id = crypto.randomUUID();
        setThreads((t) => ({ ...t, [id]: { messages: [] } }));
        navigate(`/c/${id}`, { replace: true });
      }
      const controller = new AbortController();
      controllers.current.set(id, controller);
      setBusyIds((s) => new Set(s).add(id));
      setThreads((t) => ({
        ...t,
        [id]: {
          messages: [
            ...(t[id]?.messages ?? []),
            { id: crypto.randomUUID(), role: "user", text: message },
            { id: crypto.randomUUID(), role: "assistant", text: "", steps: [], status: "streaming", startedAt: Date.now() },
          ],
        },
      }));

      const onEvent = (event, data) => {
        if (event === "status") refreshHistory(); // la conversazione esiste: compare subito nella cronologia
        else if (event === "tool_start") update(id, (m) => ({ ...m, text: "", steps: [...m.steps, { ...data, running: true }] }));
        else if (event === "tool_end") update(id, (m) => ({ ...m, steps: m.steps.map((s) => (s.id === data.id ? { ...s, ...data, running: false } : s)) }));
        else if (event === "token") update(id, (m) => ({ ...m, text: m.text + data.text }));
        else if (event === "final") {
          update(id, (m) => ({
            ...m, text: data.answer, steps: data.steps, status: "done", durationMs: Date.now() - m.startedAt,
            generations: data.generations, requestedModel: data.requestedModel,
          }));
        }
        else if (event === "error") update(id, (m) => ({ ...m, status: "error", error: data.message, steps: m.steps.map((s) => ({ ...s, running: false })) }));
      };

      try {
        await streamChat({ message, sessionId: id, signal: controller.signal, onEvent });
        update(id, (m) => (m.status === "streaming" ? { ...m, status: "error", error: "La risposta si è interrotta. Riprova." } : m));
      } catch (err) {
        const stopped = controller.signal.aborted;
        update(id, (m) => ({
          ...m,
          status: stopped ? "stopped" : "error",
          steps: m.steps.map((s) => ({ ...s, running: false })),
          error: stopped
            ? "Risposta interrotta."
            : err.name === "TimeoutError"
              ? "Nessuna risposta in tempo utile. Riprova tra poco."
              : err.message || "Impossibile contattare il server.",
        }));
      } finally {
        controllers.current.delete(id);
        setBusyIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
        refreshHistory();
      }
    },
    [currentId, busyIds, update, refreshHistory],
  );

  const remove = useCallback(
    async (id) => {
      try {
        await api.deleteConversation(id);
      } catch (err) {
        window.alert(err.message);
        return;
      }
      setThreads(({ [id]: _removed, ...rest }) => rest);
      if (currentId === id) navigate("/");
      refreshHistory();
    },
    [currentId, refreshHistory],
  );

  const openDoc = useCallback((source, section) => setDocTarget({ source, section }), []);
  // il pannello del documento appartiene alla conversazione: si chiude cambiando pagina o conversazione
  const routeKey = `${route.view}/${route.id ?? route.tab ?? ""}`;
  useEffect(() => setDocTarget(null), [routeKey]);
  const title = currentId ? history?.find((c) => c.id === currentId)?.title : null;

  return (
    <div className="app">
      <Sidebar route={route} history={history} busyIds={busyIds} health={health} onDelete={remove}
        open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="main">
        <button type="button" className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Apri il menu">
          <IconMenu />
        </button>
        {route.view === "chat" && (
          // una conversazione salvata non ancora caricata è già "in caricamento" dal primo render: niente benvenuto
          <ChatView key={currentId ?? "new"} thread={currentId ? (threads[currentId] ?? LOADING_THREAD) : null} title={title}
            busy={currentId ? busyIds.has(currentId) : false} onSend={send}
            onStop={() => controllers.current.get(currentId)?.abort()} onOpenDoc={openDoc} />
        )}
        {route.view === "kb" && <KnowledgeBase route={route} onChanged={refreshHealth} />}
        {route.view === "settings" && <Settings onChanged={refreshHealth} />}
      </div>
      {docTarget && <DocDrawer target={docTarget} onClose={() => setDocTarget(null)} />}
    </div>
  );
}
