import { useEffect, useRef, useState } from "react";

const MAX = 2000;

export default function Composer({ busy, onSend, onStop }) {
  const [text, setText] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!busy) ref.current?.focus();
  }, [busy]);

  const submit = (e) => {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    onSend(text);
    setText("");
  };

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-box">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={MAX}
          placeholder="Chiedi di regole o dati delle campagne…"
          aria-label="Messaggio"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
          }}
        />
        {busy ? (
          <button type="button" className="btn btn-stop" onClick={onStop}>
            Interrompi
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
            Invia
          </button>
        )}
      </div>
      <div className="composer-foot">
        <span>Dati sintetici di un'azienda fittizia · le risposte generate dall'AI possono contenere errori</span>
        {text.length > MAX * 0.8 && <span>{text.length}/{MAX}</span>}
      </div>
    </form>
  );
}
