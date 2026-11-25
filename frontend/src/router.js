import { useEffect, useState } from "react";

// Routing minimale sull'hash dell'URL: niente dipendenze, e il back end non deve conoscere le route.
//   #/              nuova chat          #/c/<id>         conversazione
//   #/kb/<sezione>  knowledge base      #/impostazioni   impostazioni
export function parseRoute(hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "c" && parts[1]) return { view: "chat", id: parts[1] };
  if (parts[0] === "kb") return { view: "kb", tab: parts[1] ?? "documenti", item: parts[2] ?? null };
  if (parts[0] === "impostazioni") return { view: "settings" };
  return { view: "chat", id: null };
}

export function navigate(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (replace) {
    history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = hash;
  }
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
