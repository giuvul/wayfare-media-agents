import { useEffect, useRef } from "react";

import Composer from "./Composer.jsx";
import Message from "./Message.jsx";
import Welcome from "./Welcome.jsx";

export default function ChatView({ thread, title, busy, onSend, onStop, onOpenDoc }) {
  const scrollRef = useRef(null);
  const stick = useRef(true); // segue il fondo solo se l'utente non è risalito a leggere

  const messages = thread?.messages ?? [];
  useEffect(() => {
    const el = scrollRef.current;
    // la schermata di benvenuto parte dall'alto; una conversazione segue l'ultimo messaggio
    if (el && stick.current && messages.length > 0) el.scrollTop = el.scrollHeight;
  }, [thread, messages.length]);

  return (
    <div className="chat">
      <header className="view-head">
        <h1 className="view-title">{title ?? "Nuova conversazione"}</h1>
      </header>
      <main
        className="conversation"
        ref={scrollRef}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {thread?.error && <div className="notice notice-error">{thread.error}</div>}
        {thread?.loading && <p className="muted">Caricamento della conversazione…</p>}
        {!thread?.loading && !thread?.error && messages.length === 0 && <Welcome onPick={onSend} />}
        {messages.map((m) => (
          <Message key={m.id} message={m} onOpenDoc={onOpenDoc} />
        ))}
      </main>
      <Composer busy={busy} onSend={(t) => { stick.current = true; onSend(t); }} onStop={onStop} />
    </div>
  );
}
