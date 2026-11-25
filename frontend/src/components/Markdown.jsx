import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { remarkCitations } from "../citations.js";

/**
 * Markdown sicuro (niente HTML grezzo) con citazioni cliccabili.
 * @param {{ children: string, onCite?: (sectionId: string) => void, className?: string }} props
 */
export default function Markdown({ children, onCite, className }) {
  const components = {
    a: ({ node: _node, href = "", children: label, ...props }) => {
      if (href.startsWith("#cite-")) {
        const id = href.slice(6);
        return onCite ? (
          <button type="button" className="cite" onClick={() => onCite(id)} title={`Apri la sezione §${id} nel documento`}>
            {label}
          </button>
        ) : (
          <span className="cite cite-static">{label}</span>
        );
      }
      return <a href={href} {...props} target="_blank" rel="noreferrer noopener">{label}</a>;
    },
  };
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={onCite !== false ? [remarkGfm, remarkCitations] : [remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
