/** Riga di un catalogo di modelli: nome, id, dettagli e il pulsante per sceglierlo (o "In uso"). */
export default function ModelRow({ name, id, meta, inUse, disabled, onUse }) {
  return (
    <li className={inUse ? "is-current" : ""}>
      <div className="model-info">
        <strong>{name}</strong>
        <code>{id}</code>
      </div>
      {meta.map((text, i) => <span key={i} className="model-meta">{text}</span>)}
      {inUse ? (
        <span className="badge badge-ok">In uso</span>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} onClick={onUse}>Usa</button>
      )}
    </li>
  );
}
